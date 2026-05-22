const mongoose = require("mongoose");

const LeaveRequestSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
  },
  employee_name: { type: String },
  department:    { type: String },
  leave_type:    { type: String, required: true },
  from_date:     { type: String, required: true },
  to_date:       { type: String, required: true },
  reason:        { type: String, default: "" },

  is_half_day: { type: Boolean, default: false },
  session: {
    type: String,
    enum: ["morning", "afternoon", null],
    default: null,
  },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  hr_remark:   { type: String, default: "" },
  approved_by: { type: mongoose.Schema.Types.ObjectId, ref: "HR" },
}, { timestamps: true });

module.exports = mongoose.model("LeaveRequest", LeaveRequestSchema);