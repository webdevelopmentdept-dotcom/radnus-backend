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
  
    // ── Team Lead approval flow ──
  current_stage:  { type: String, enum: ["team_lead", "hr", "completed"], default: "hr" },
  tl_approver_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
  tl_status:      { type: String, enum: ["not_required", "pending", "approved", "rejected"], default: "not_required" },
  tl_remark:      { type: String, default: "" },
  tl_acted_at:    { type: Date, default: null },


}, { timestamps: true });

module.exports = mongoose.model("LeaveRequest", LeaveRequestSchema);