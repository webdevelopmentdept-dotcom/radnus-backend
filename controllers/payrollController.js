// controllers/payrollController.js
const mongoose = require("mongoose");
const Payroll  = require("../models/Payroll");
const Payslip  = require("../models/Payslip");
const Employee = require("../models/Employee");
const EmploymentDetails = require("../models/EmploymentDetails");
const { computeAttendanceSummary, computeSalaryBreakdown, getTotalDaysInMonth } = require("../helpers/payrollCalculator");
const Advance  = require("../models/Advance");   

const { createNotification } = require("../helpers/notificationHelper");

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

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

    // ── Notify every employee that their payslip is approved & ready to view ──
    const approvedPayslips = await Payslip.find({ payroll_run_id: run._id })
      .select("employee_id employee_name net_pay").lean();
    await Promise.all(approvedPayslips.map((p) => createNotification({
      recipient_id:   String(p.employee_id),
      recipient_role: "employee",
      type:           "salary",
      title:          "Payslip Approved ✅",
      message:        `Your payslip for ${MONTH_NAMES[run.month]} ${run.year} has been approved. Net Pay: ₹${Number(p.net_pay || 0).toLocaleString("en-IN")}.`,
      link:           "/employee/my-payslips",
    })));

    // Lock in any advances that were recovered via this run

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

    // ── Notify every employee that their salary has been paid ──────
    const paidPayslips = await Payslip.find({ payroll_run_id: run._id })
      .select("employee_id employee_name net_pay").lean();
    await Promise.all(paidPayslips.map((p) => createNotification({
      recipient_id:   String(p.employee_id),
      recipient_role: "employee",
      type:           "salary",
      title:          "Salary Paid 💰",
      message:        `Your salary of ₹${Number(p.net_pay || 0).toLocaleString("en-IN")} for ${MONTH_NAMES[run.month]} ${run.year} has been paid.`,
      link:           "/employee/my-payslips",
    })));

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

    // ── Notify the employee that their salary has been paid ────────
    await createNotification({
      recipient_id:   String(payslip.employee_id),
      recipient_role: "employee",
      type:           "salary",
      title:          "Salary Paid 💰",
      message:        `Your salary of ₹${Number(payslip.net_pay || 0).toLocaleString("en-IN")} for ${MONTH_NAMES[payslip.month]} ${payslip.year} has been paid.`,
      link:           "/employee/my-payslips",
    });

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


// ── PUT /api/payroll/payslip/:id ────────────────────────────────
// HR: full edit of a draft payslip's employee/period info,
// earnings/deductions/attendance
exports.updatePayslip = async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id);
    if (!payslip) return res.status(404).json({ success: false, message: "Payslip not found" });

    if (payslip.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft payslips can be edited. Undo the payroll approval first.",
      });
    }

    const {
      employee_name, designation, department, employee_code, date_of_joining,
      month, year, worked_days,
      earnings, deductions, absent_days, half_days, other_deduction, edited_by,
    } = req.body;

    // ── Employee & period info (simple overrides, display-only fields) ──
    if (employee_name !== undefined) payslip.employee_name = employee_name;
    if (designation !== undefined) payslip.designation = designation;
    if (department !== undefined) payslip.department = department;
    if (employee_code !== undefined) payslip.employee_code = employee_code;
    if (date_of_joining !== undefined) payslip.date_of_joining = date_of_joining;
    if (month !== undefined) payslip.month = Number(month) || payslip.month;
    if (year !== undefined) payslip.year = Number(year) || payslip.year;

    // ── Earnings / deductions / attendance ──
    if (earnings) Object.assign(payslip.earnings, earnings);
    if (deductions) Object.assign(payslip.deductions, deductions);
    if (absent_days !== undefined) payslip.absent_days = Number(absent_days) || 0;
    if (half_days !== undefined) payslip.half_days = Number(half_days) || 0;
    if (other_deduction) {
      payslip.other_deduction = {
        amount: Number(other_deduction.amount) || 0,
        reason: other_deduction.reason || "",
        added_by: edited_by || "",
        added_at: new Date(),
      };
    }

    // ── Worked Days edit: back-calculate present_days, then recompute
    //    payable_days and scale earnings proportionally so Total Earnings
    //    & Net Pay follow the new worked-days total ──
    if (worked_days !== undefined) {
      const half = payslip.half_days || 0;
      const paidLeave = payslip.paid_leave_days || 0;
      let newPresent = Number(worked_days) - half * 0.5 - paidLeave;
      if (newPresent < 0) newPresent = 0;
      payslip.present_days = Math.round(newPresent * 100) / 100;

      const payableDays =
        payslip.present_days + half * 0.5 + paidLeave +
        (payslip.holiday_days || 0) + (payslip.weekend_days || 0);
      payslip.payable_days = Math.round(payableDays * 100) / 100;

      const oldGross = payslip.earnings.gross_earnings || 0;
      const newGrossFromDays = Math.round((payslip.per_day_rate || 0) * payableDays * 100) / 100;
      const ratio = oldGross > 0 ? newGrossFromDays / oldGross : 1;

      // scale the fixed salary components (overtime stays as-is — it's separate from worked days)
      payslip.earnings.basic = Math.round((payslip.earnings.basic || 0) * ratio * 100) / 100;
      payslip.earnings.hra = Math.round((payslip.earnings.hra || 0) * ratio * 100) / 100;
      payslip.earnings.special_allowance = Math.round((payslip.earnings.special_allowance || 0) * ratio * 100) / 100;
      payslip.earnings.conveyance_allowance = Math.round((payslip.earnings.conveyance_allowance || 0) * ratio * 100) / 100;
    }

    // ── recalculate gross_earnings, total_deductions, net_pay ──
    const e = payslip.earnings;
    payslip.earnings.gross_earnings =
      (e.basic || 0) + (e.hra || 0) + (e.special_allowance || 0) +
      (e.conveyance_allowance || 0) + (e.overtime_amount || 0);

    const d = payslip.deductions;
    const advanceTotal = (payslip.advance_recoveries || []).reduce((s, a) => s + (a.amount || 0), 0);
    payslip.deductions.total_deductions =
      (d.pf || 0) + (d.esi || 0) + (d.tds || 0) + (d.professional_tax || 0) +
      advanceTotal + (payslip.other_deduction?.amount || 0);

    const lopAmount = (payslip.absent_days || 0) * (payslip.per_day_rate || 0);
    const halfDayAmount = (payslip.half_days || 0) * (payslip.per_day_rate || 0) * 0.5;

    payslip.net_pay = Math.round(
      (payslip.earnings.gross_earnings - payslip.deductions.total_deductions - lopAmount - halfDayAmount) * 100
    ) / 100;

    await payslip.save();
    res.json({ success: true, data: payslip });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/payroll/payslip/:id ────────────────────────────────
// HR: full edit of a draft payslip's employee/period info,
// earnings/deductions/attendance
exports.updatePayslip = async (req, res) => {
  try {
    const payslip = await Payslip.findById(req.params.id);
    if (!payslip) return res.status(404).json({ success: false, message: "Payslip not found" });

    if (payslip.status !== "draft") {
      return res.status(400).json({
        success: false,
        message: "Only draft payslips can be edited. Undo the payroll approval first.",
      });
    }

    const {
      employee_name, designation, department, employee_code, date_of_joining,
      month, year, worked_days,
      earnings, deductions, lop_days, half_days, other_deduction, edited_by,
    } = req.body;

    // ── Employee & period info (simple overrides, display-only fields) ──
    if (employee_name !== undefined) payslip.employee_name = employee_name;
    if (designation !== undefined) payslip.designation = designation;
    if (department !== undefined) payslip.department = department;
    if (employee_code !== undefined) payslip.employee_code = employee_code;
    if (date_of_joining !== undefined) payslip.date_of_joining = date_of_joining;
    if (month !== undefined) payslip.month = Number(month) || payslip.month;
    if (year !== undefined) payslip.year = Number(year) || payslip.year;

    // ── Earnings / deductions / attendance ──
    if (earnings) Object.assign(payslip.earnings, earnings);
    if (deductions) Object.assign(payslip.deductions, deductions);
    if (half_days !== undefined) payslip.half_days = Number(half_days) || 0;

    const oldLopDays = payslip.lop_days ?? ((payslip.absent_days || 0) + (payslip.unpaid_leave_days || 0));
    let lopDelta = 0;
    if (lop_days !== undefined) {
      const newLopDays = Number(lop_days) || 0;
      lopDelta = newLopDays - oldLopDays; // +ve = more LOP days added, -ve = LOP days removed
      payslip.lop_days = newLopDays;
      // mirror onto the raw fields too, so any other screen reading
      // absent_days/unpaid_leave_days directly stays consistent
      payslip.absent_days = payslip.lop_days;
      payslip.unpaid_leave_days = 0;
    }
    if (other_deduction) {
      payslip.other_deduction = {
        amount: Number(other_deduction.amount) || 0,
        reason: other_deduction.reason || "",
        added_by: edited_by || "",
        added_at: new Date(),
      };
    }

    // ── Recompute present_days from whichever attendance input changed:
    //    explicit "Worked Days" edit takes priority; otherwise, an LOP-days
    //    change shifts present_days by the opposite delta (so +1 LOP day
    //    removes exactly 1 day's pay, and vice versa) ──
    let presentDaysChanged = false;

    if (worked_days !== undefined) {
      const half = payslip.half_days || 0;
      const paidLeave = payslip.paid_leave_days || 0;
      const holiday = payslip.holiday_days || 0;
      const weekend = payslip.weekend_days || 0;
      let newPresent = Number(worked_days) - half * 0.5 - paidLeave - holiday - weekend;
      if (newPresent < 0) newPresent = 0;
      payslip.present_days = Math.round(newPresent * 100) / 100;
      presentDaysChanged = true;
    } else if (lopDelta !== 0) {
      let newPresent = (payslip.present_days || 0) - lopDelta;
      if (newPresent < 0) newPresent = 0;
      payslip.present_days = Math.round(newPresent * 100) / 100;
      presentDaysChanged = true;
    }

    if (presentDaysChanged) {
      const half = payslip.half_days || 0;
      const paidLeave = payslip.paid_leave_days || 0;
      const payableDays =
        payslip.present_days + half * 0.5 + paidLeave +
        (payslip.holiday_days || 0) + (payslip.weekend_days || 0);
      payslip.payable_days = Math.round(payableDays * 100) / 100;

      const oldGross = payslip.earnings.gross_earnings || 0;
      const newGrossFromDays = Math.round((payslip.per_day_rate || 0) * payableDays * 100) / 100;
      const ratio = oldGross > 0 ? newGrossFromDays / oldGross : 1;

      // scale the fixed salary components (overtime stays as-is — it's separate from attendance)
      payslip.earnings.basic = Math.round((payslip.earnings.basic || 0) * ratio * 100) / 100;
      payslip.earnings.hra = Math.round((payslip.earnings.hra || 0) * ratio * 100) / 100;
      payslip.earnings.special_allowance = Math.round((payslip.earnings.special_allowance || 0) * ratio * 100) / 100;
      payslip.earnings.conveyance_allowance = Math.round((payslip.earnings.conveyance_allowance || 0) * ratio * 100) / 100;
    }

    // ── recalculate gross_earnings, total_deductions, net_pay ──
    const e = payslip.earnings;
    payslip.earnings.gross_earnings =
      (e.basic || 0) + (e.hra || 0) + (e.special_allowance || 0) +
      (e.conveyance_allowance || 0) + (e.overtime_amount || 0);

    const d = payslip.deductions;
    const advanceTotal = (payslip.advance_recoveries || []).reduce((s, a) => s + (a.amount || 0), 0);
    payslip.deductions.total_deductions =
      (d.pf || 0) + (d.esi || 0) + (d.tds || 0) + (d.professional_tax || 0) +
      advanceTotal + (payslip.other_deduction?.amount || 0);

    // net_pay = gross_earnings − total_deductions ONLY.
    // NOTE: LOP/Half-day amounts are already excluded from gross_earnings
    // (payable_days used at payroll generation time already skips absent/LOP
    // days). They're shown as a separate line on the payslip purely for
    // employee-facing breakdown — do NOT subtract them again here, or the
    // deduction gets counted twice.
    payslip.net_pay = Math.round(
      (payslip.earnings.gross_earnings - payslip.deductions.total_deductions) * 100
    ) / 100;

    await payslip.save();
    res.json({ success: true, data: payslip });
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