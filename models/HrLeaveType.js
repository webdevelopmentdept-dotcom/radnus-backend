const mongoose = require("mongoose");
const hrLeaveTypeSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  days_allowed: { type: Number, default: 12 },
  paid:         { type: Boolean, default: true },
  color:        { type: String, default: "#16a34a" },
}, { timestamps: true });
module.exports = mongoose.model("HrLeaveType", hrLeaveTypeSchema);