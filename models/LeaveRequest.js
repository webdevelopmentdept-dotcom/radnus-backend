const mongoose = require("mongoose");

const LeaveRequestSchema = new mongoose.Schema({
  employee_id:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  employee_name: { type: String },
  department:    { type: String },
  leave_type:    { type: String, required: true },
  from_date:     { type: String, required: true },  // "YYYY-MM-DD"
  to_date:       { type: String, required: true },
  reason:        { type: String, required: true },
  status:        { type: String, enum: ["pending","approved","rejected"], default: "pending" },
  hr_remark:     { type: String, default: "" },
  approved_by:   { type: mongoose.Schema.Types.ObjectId, ref: "HR" },
}, { timestamps: true });

module.exports = mongoose.model("LeaveRequest", LeaveRequestSchema);