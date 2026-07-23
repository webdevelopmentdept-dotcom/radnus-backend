const mongoose = require("mongoose");

const payrollSchema = new mongoose.Schema({
  month: { type: Number, required: true }, // 1-12
  year:  { type: Number, required: true },

  total_days_in_month: { type: Number, required: true }, // 30 / 31 / 28 / 29

  total_employees:  { type: Number, default: 0 },
  total_gross:       { type: Number, default: 0 },
  total_deductions:  { type: Number, default: 0 },
  total_net_pay:      { type: Number, default: 0 },

  status: {
    type: String,
    enum: ["draft", "approved", "paid"],
    default: "draft",
  },

  generated_by: { type: String, default: "" }, // HR name/id who generated
  approved_by:  { type: String, default: "" },
  approved_at:  { type: Date },
  paid_at:      { type: Date },

  remarks: { type: String, default: "" },
}, { timestamps: true });

// One payroll run per month+year
payrollSchema.index({ month: 1, year: 1 }, { unique: true });

module.exports = mongoose.model("Payroll", payrollSchema);