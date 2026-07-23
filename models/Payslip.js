const mongoose = require("mongoose");

const payslipSchema = new mongoose.Schema({
  payroll_run_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Payroll",
    required: true,
  },
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
  },

  employee_name: { type: String },
  department:    { type: String },
  designation:   { type: String },
  employee_code: { type: String },

  month: { type: Number, required: true },
  year:  { type: Number, required: true },

  // ── Attendance summary (snapshot, from Attendance collection) ──
  total_days_in_month: { type: Number, required: true },
  present_days:         { type: Number, default: 0 },
  half_days:            { type: Number, default: 0 },
  paid_leave_days:      { type: Number, default: 0 },
  unpaid_leave_days:    { type: Number, default: 0 },
  absent_days:          { type: Number, default: 0 },
  holiday_days:         { type: Number, default: 0 },
  weekend_days:         { type: Number, default: 0 },
  lop_days:             { type: Number, default: 0 }, // Loss of Pay = absent + unpaid leave
  payable_days:         { type: Number, default: 0 }, // present + (half*0.5) + paid leave
  overtime_minutes:     { type: Number, default: 0 },

  // ── Salary snapshot (from EmploymentDetails.salary) ─────────────
  gross_salary_monthly: { type: Number, required: true }, // fixed monthly gross, as configured
  per_day_rate:          { type: Number, required: true }, // gross_salary_monthly / total_days_in_month

  earnings: {
    basic:                 { type: Number, default: 0 },
    hra:                   { type: Number, default: 0 },
    special_allowance:     { type: Number, default: 0 },
    conveyance_allowance:  { type: Number, default: 0 },
    overtime_amount:       { type: Number, default: 0 },
    gross_earnings:        { type: Number, default: 0 }, // per_day_rate * payable_days (+ OT)
  },

  // ── Deductions — currently 0 unless employee.pf/esi/tds_applicable = true ──
  // Percentage/formula config is pending from HR; structure is ready for later.
  deductions: {
    pf:                { type: Number, default: 0 },
    esi:               { type: Number, default: 0 },
    tds:               { type: Number, default: 0 },
    professional_tax:  { type: Number, default: 0 },
    lop_deduction:      { type: Number, default: 0 }, // informational; LOP already excluded from payable_days
    other:             { type: Number, default: 0 },
    total_deductions:   { type: Number, default: 0 },
  },

  net_pay: { type: Number, default: 0 },

  status: {
    type: String,
    enum: ["draft", "approved", "paid"],
    default: "draft",
  },

  payment_date: { type: Date },
  payment_ref:  { type: String, default: "" }, // UTR/txn ref once paid
  remarks:      { type: String, default: "" },
}, { timestamps: true });

// One payslip per employee per payroll run
payslipSchema.index({ payroll_run_id: 1, employee_id: 1 }, { unique: true });
payslipSchema.index({ employee_id: 1, year: 1, month: 1 });

module.exports = mongoose.model("Payslip", payslipSchema);