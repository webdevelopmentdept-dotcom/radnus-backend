// models/Advance.js
const mongoose = require("mongoose");

const advanceSchema = new mongoose.Schema({
  employee_id:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  employee_name: { type: String, default: "" },
  department:    { type: String, default: "" },

  amount: { type: Number, required: true },  // advance amount requested / approved
  reason: { type: String, required: true },  // why the advance is needed (employee-entered)

  requested_by: { type: String, enum: ["employee", "hr"], default: "employee" },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "recovered"],
    default: "pending",
  },

  // Which payroll month/year this advance must be deducted (recovered) from.
  // Defaults to the month it was approved in, HR can change it while approving.
  recovery_month: { type: Number },
  recovery_year:  { type: Number },

  hr_remarks:  { type: String, default: "" }, // shown to employee — approval note / rejection reason
  approved_by: { type: String, default: "" },
  approved_at: { type: Date },
  rejected_at: { type: Date },

  // Set once this advance has actually been deducted via a payroll run
  recovered_in_payroll_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "Payroll" },
  recovered_at: { type: Date },
}, { timestamps: true });

advanceSchema.index({ employee_id: 1, status: 1 });
advanceSchema.index({ status: 1, recovery_month: 1, recovery_year: 1 });

module.exports = mongoose.model("Advance", advanceSchema);