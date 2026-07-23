// controllers/payrollController.js
const mongoose = require("mongoose");
const Payroll  = require("../models/Payroll");
const Payslip  = require("../models/Payslip");
const Employee = require("../models/Employee");
const EmploymentDetails = require("../models/EmploymentDetails");
const { computeAttendanceSummary, computeSalaryBreakdown, getTotalDaysInMonth } = require("../helpers/payrollCalculator");

// ── POST /api/payroll/generate ─────────────────────────────────────
// body: { month, year, generated_by, statutory_rates? }
exports.generatePayroll = async (req, res) => {
  try {
    const { month, year, generated_by, statutory_rates } = req.body;
    if (!month || !year) {
      return res.status(400).json({ success: false, message: "month and year are required" });
    }

    let run = await Payroll.findOne({ month, year });
    if (run && run.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: `Payroll for ${month}/${year} is already ${run.status}. Cannot regenerate.`,
      });
    }

    // Only employees with an ACTIVE employment/salary record are payroll-eligible
    const employmentRecords = await EmploymentDetails.find({ status: "active" }).lean();
    if (employmentRecords.length === 0) {
      return res.status(400).json({ success: false, message: "No active employees with salary configured" });
    }

    const totalDaysInMonth = getTotalDaysInMonth(month, year);
    const employeeIds = employmentRecords.map((e) => e.employee_id);
    const employees = await Employee.find({ _id: { $in: employeeIds } }).lean();
    const employeeMap = {};
    employees.forEach((e) => { employeeMap[e._id.toString()] = e; });

    if (!run) {
      run = await Payroll.create({
        month, year, total_days_in_month: totalDaysInMonth,
        generated_by: generated_by || "", status: "draft",
      });
    }

    let totalGross = 0, totalDeductions = 0, totalNet = 0, count = 0;

    for (const empDetails of employmentRecords) {
      const emp = employeeMap[empDetails.employee_id.toString()];
      if (!emp || emp.status !== "active") continue; // skip relieved/fired/pending

      const attendanceSummary = await computeAttendanceSummary(empDetails.employee_id, month, year);
      const { perDayRate, earnings, deductions, netPay } = computeSalaryBreakdown(
        empDetails.salary, attendanceSummary, statutory_rates || {}
      );

      // Full fixed monthly salary (before any LOP/attendance reduction)
      const grossSalaryMonthly = empDetails.salary?.gross_salary || 0;
      // LOP amount = absent days × per-day rate — this is a deduction, separate from earnings.gross_earnings
      const lopAmount = Math.round((attendanceSummary.lop_days || 0) * perDayRate * 100) / 100;

      const payslipData = {
        payroll_run_id: run._id,
        employee_id: empDetails.employee_id,
        employee_name: emp.name,
        department: emp.department,
        designation: emp.designation,
        employee_code: empDetails.employment?.employee_code || "",
        month, year,
        total_days_in_month: attendanceSummary.total_days_in_month,
        present_days: attendanceSummary.present_days,
        half_days: attendanceSummary.half_days,
        paid_leave_days: attendanceSummary.paid_leave_days,
        unpaid_leave_days: attendanceSummary.unpaid_leave_days,
        absent_days: attendanceSummary.absent_days,
        holiday_days: attendanceSummary.holiday_days,
        weekend_days: attendanceSummary.weekend_days,
        lop_days: attendanceSummary.lop_days,
        payable_days: attendanceSummary.payable_days,
        overtime_minutes: attendanceSummary.overtime_minutes,
        gross_salary_monthly: grossSalaryMonthly,
        per_day_rate: perDayRate,
        earnings,
        deductions,
        net_pay: netPay,
        status: "draft",
      };

      await Payslip.findOneAndUpdate(
        { payroll_run_id: run._id, employee_id: empDetails.employee_id },
        payslipData,
        { upsert: true, new: true }
      );

      totalGross += grossSalaryMonthly;
      totalDeductions += lopAmount + deductions.total_deductions;
      totalNet += netPay;
      count += 1;
    }

    run.total_employees = count;
    run.total_gross = Math.round(totalGross * 100) / 100;
    run.total_deductions = Math.round(totalDeductions * 100) / 100;
    run.total_net_pay = Math.round(totalNet * 100) / 100;
    await run.save();

    res.json({ success: true, message: "Payroll generated", data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/payroll/runs ──────────────────────────────────────────
exports.getPayrollRuns = async (req, res) => {
  try {
    const runs = await Payroll.find().sort({ year: -1, month: -1 });
    res.json({ success: true, data: runs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/payroll/runs/:runId ───────────────────────────────────
exports.getPayrollRunById = async (req, res) => {
  try {
    const run = await Payroll.findById(req.params.runId);
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
    res.json({ success: true, data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/payroll/runs/:runId/payslips ──────────────────────────
exports.getPayslipsByRun = async (req, res) => {
  try {
    const payslips = await Payslip.find({ payroll_run_id: req.params.runId }).sort({ employee_name: 1 });
    res.json({ success: true, data: payslips });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/payroll/payslip/:id ───────────────────────────────────
exports.getPayslipById = async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id);
    if (!payslip) return res.status(404).json({ success: false, message: "Payslip not found" });
    res.json({ success: true, data: payslip });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/payroll/employee/:employeeId ──────────────────────────
// Employee self-service: list own payslips
exports.getEmployeePayslips = async (req, res) => {
  try {
    const payslips = await Payslip.find({
      employee_id: req.params.employeeId,
      status: { $in: ["approved", "paid"] }, // employees only see finalized payslips
    }).sort({ year: -1, month: -1 });
    res.json({ success: true, data: payslips });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/payroll/runs/:id/approve ──────────────────────────────
exports.approvePayroll = async (req, res) => {
  try {
    const { approved_by } = req.body;
    const run = await Payroll.findById(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
    if (run.status !== "draft") {
      return res.status(400).json({ success: false, message: `Already ${run.status}` });
    }

    run.status = "approved";
    run.approved_by = approved_by || "";
    run.approved_at = new Date();
    await run.save();

    await Payslip.updateMany({ payroll_run_id: run._id }, { status: "approved" });

    res.json({ success: true, message: "Payroll approved", data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/payroll/runs/:id/mark-paid ────────────────────────────
exports.markAsPaid = async (req, res) => {
  try {
    const run = await Payroll.findById(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
    if (run.status !== "approved") {
      return res.status(400).json({ success: false, message: "Approve the payroll before marking as paid" });
    }

    run.status = "paid";
    run.paid_at = new Date();
    await run.save();

    await Payslip.updateMany(
      { payroll_run_id: run._id },
      { status: "paid", payment_date: new Date() }
    );

    res.json({ success: true, message: "Payroll marked as paid", data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/payroll/runs/:id ───────────────────────────────────
// Only draft runs can be deleted (e.g. generated by mistake)
exports.deletePayrollRun = async (req, res) => {
  try {
    const run = await Payroll.findById(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
    if (run.status !== "draft") {
      return res.status(400).json({ success: false, message: "Only draft payroll runs can be deleted" });
    }
    await Payslip.deleteMany({ payroll_run_id: run._id });
    await run.deleteOne();
    res.json({ success: true, message: "Payroll run deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/payroll/payslip/:id/mark-paid ──────────────────────────
exports.markPayslipAsPaid = async (req, res) => {
  try {
    const { payment_ref } = req.body;
    const payslip = await Payslip.findById(req.params.id);
    if (!payslip) return res.status(404).json({ success: false, message: "Payslip not found" });

    if (payslip.status === "draft") {
      return res.status(400).json({
        success: false,
        message: "Approve the payroll run before marking individual payslips as paid",
      });
    }
    if (payslip.status === "paid") {
      return res.status(400).json({ success: false, message: "This payslip is already marked as paid" });
    }

    payslip.status = "paid";
    payslip.payment_date = new Date();
    if (payment_ref) payslip.payment_ref = payment_ref;
    await payslip.save();

    const run = await Payroll.findById(payslip.payroll_run_id);
    if (run && run.status !== "paid") {
      const unpaidCount = await Payslip.countDocuments({
        payroll_run_id: run._id,
        status: { $ne: "paid" },
      });
      if (unpaidCount === 0) {
        run.status = "paid";
        run.paid_at = new Date();
        await run.save();
      }
    }

    res.json({ success: true, message: "Payslip marked as paid", data: payslip });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/payroll/payslip/:id/mark-pending ────────────────────────
exports.markPayslipAsPending = async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id);
    if (!payslip) return res.status(404).json({ success: false, message: "Payslip not found" });
    if (payslip.status !== "paid") {
      return res.status(400).json({ success: false, message: "Only a paid payslip can be reverted" });
    }

    payslip.status = "approved";
    payslip.payment_date = undefined;
    await payslip.save();

    const run = await Payroll.findById(payslip.payroll_run_id);
    if (run && run.status === "paid") {
      run.status = "approved";
      run.paid_at = undefined;
      await run.save();
    }

    res.json({ success: true, message: "Payslip reverted to pending", data: payslip });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/payroll/runs/:id/revert-approval ──────────────────────
exports.revertPayrollApproval = async (req, res) => {
  try {
    const run = await Payroll.findById(req.params.id);
    if (!run) return res.status(404).json({ success: false, message: "Payroll run not found" });
    if (run.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: run.status === "paid"
          ? "Cannot revert a payroll run that has already been marked as paid."
          : "Only an approved payroll run can be reverted to draft.",
      });
    }

    run.status = "draft";
    run.approved_by = "";
    run.approved_at = undefined;
    await run.save();

    await Payslip.updateMany({ payroll_run_id: run._id }, { status: "draft" });

    res.json({ success: true, message: "Payroll reverted to draft", data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};