// controllers/payrollController.js
const mongoose = require("mongoose");
const Payroll  = require("../models/Payroll");
const Payslip  = require("../models/Payslip");
const Employee = require("../models/Employee");
const EmploymentDetails = require("../models/EmploymentDetails");
const { computeAttendanceSummary, computeSalaryBreakdown, getTotalDaysInMonth } = require("../helpers/payrollCalculator");
const Advance  = require("../models/Advance");   

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

      // ── Salary advance recovery ──────────────────────────────────
      const advancesToRecover = await Advance.find({
        employee_id: empDetails.employee_id,
        status: "approved",
        recovery_month: month,
        recovery_year: year,
      }).lean();

      const advanceDeduction = Math.round(
        advancesToRecover.reduce((sum, a) => sum + (Number(a.amount) || 0), 0) * 100
      ) / 100;

      if (advanceDeduction > 0) {
        deductions.advance = advanceDeduction;
        deductions.total_deductions = Math.round((deductions.total_deductions + advanceDeduction) * 100) / 100;
      }

     const advanceRecoveries = advancesToRecover.map((a) => ({
        advance_id: a._id,
        amount: a.amount,
        reason: a.reason,
      }));

      // ── Preserve any HR-added "Other Deduction" across regeneration ──
      // (findOneAndUpdate below would otherwise wipe it out on every re-generate)
      const existingPayslip = await Payslip.findOne({
        payroll_run_id: run._id,
        employee_id: empDetails.employee_id,
      }).select("other_deduction").lean();

      const otherDeduction = existingPayslip?.other_deduction?.amount
        ? existingPayslip.other_deduction
        : { amount: 0, reason: "", added_by: "" };

      if (otherDeduction.amount > 0) {
        deductions.total_deductions = Math.round((deductions.total_deductions + otherDeduction.amount) * 100) / 100;
      }

      const netPayAfterAdvance = Math.round((netPay - advanceDeduction - (otherDeduction.amount || 0)) * 100) / 100;

      const payslipData = {
        payroll_run_id: run._id,
        employee_id: empDetails.employee_id,
        employee_name: emp.name,
        department: emp.department,
        designation: emp.designation,
        employee_code: empDetails.employment?.employee_code || "",
        date_of_joining: empDetails.employment?.date_of_joining || "",
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
        advance_recoveries: advanceRecoveries,
        other_deduction: otherDeduction,
        net_pay: netPayAfterAdvance,
        status: "draft",
      };

      await Payslip.findOneAndUpdate(
        { payroll_run_id: run._id, employee_id: empDetails.employee_id },
        payslipData,
        { upsert: true, new: true }
      );

        totalGross += grossSalaryMonthly;
      totalDeductions += lopAmount + deductions.total_deductions;
      totalNet += netPayAfterAdvance;
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

    // Lock in any advances that were recovered via this run
    const payslipsForRun = await Payslip.find({ payroll_run_id: run._id }).select("advance_recoveries").lean();
    const advanceIds = [];
    payslipsForRun.forEach((p) => (p.advance_recoveries || []).forEach((a) => {
      if (a.advance_id) advanceIds.push(a.advance_id);
    }));
    if (advanceIds.length) {
      await Advance.updateMany(
        { _id: { $in: advanceIds } },
        { status: "recovered", recovered_in_payroll_run_id: run._id, recovered_at: new Date() }
      );
    }

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

// ── PUT /api/payroll/payslip/:id/other-deduction ─────────────────────
// body: { amount, reason, added_by }
// HR sets/updates a manual "Other Deduction" on one payslip (with reason).
// Allowed only while the payslip is still "draft" — once approved, HR must
// use "Undo Approve" on the run first (same rule as other payslip edits).
exports.setOtherDeduction = async (req, res) => {
  try {
    const { amount, reason, added_by } = req.body;

    const numAmount = Number(amount);
    if (amount === undefined || amount === null || isNaN(numAmount) || numAmount < 0) {
      return res.status(400).json({ success: false, message: "A valid deduction amount is required" });
    }
    if (numAmount > 0 && !String(reason || "").trim()) {
      return res.status(400).json({ success: false, message: "A reason is required when adding a deduction" });
    }

    const payslip = await Payslip.findById(req.params.id);
    if (!payslip) return res.status(404).json({ success: false, message: "Payslip not found" });
    if (payslip.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft payslips can be edited. Undo the payroll approval first.",
      });
    }

    const newAmount = Math.round(numAmount * 100) / 100;
    const oldAmount = payslip.other_deduction?.amount || 0;
    const diff = Math.round((newAmount - oldAmount) * 100) / 100;

    payslip.other_deduction = {
      amount: newAmount,
      reason: newAmount > 0 ? String(reason).trim() : "",
      added_by: added_by || "",
      added_at: new Date(),
    };
    payslip.deductions.total_deductions = Math.round(((payslip.deductions.total_deductions || 0) + diff) * 100) / 100;
    payslip.net_pay = Math.round(((payslip.net_pay || 0) - diff) * 100) / 100;
    await payslip.save();

    // Keep the parent payroll run's totals in sync
    const run = await Payroll.findById(payslip.payroll_run_id);
    if (run) {
      run.total_deductions = Math.round(((run.total_deductions || 0) + diff) * 100) / 100;
      run.total_net_pay = Math.round(((run.total_net_pay || 0) - diff) * 100) / 100;
      await run.save();
    }

    res.json({ success: true, message: "Other deduction updated", data: payslip });
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

    // Un-recover advances so they get picked up again on regeneration
    await Advance.updateMany(
      { recovered_in_payroll_run_id: run._id },
      { status: "approved", $unset: { recovered_in_payroll_run_id: "", recovered_at: "" } }
    );

    res.json({ success: true, message: "Payroll reverted to draft", data: run });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};