const mongoose = require("mongoose");
const hrShiftSettingsSchema = new mongoose.Schema({
  shift_name:     { type: String, default: "General Shift" },
  start_time:     { type: String, default: "09:45" },
  grace_minutes:  { type: Number, default: 15 },
  end_time:       { type: String, default: "19:00" },
  lunch_duration: { type: Number, default: 60 },
  half_day_hours: { type: Number, default: 4 },
  work_days:      { type: [String], default: ["Mon","Tue","Wed","Thu","Fri","Sat"] },
}, { timestamps: true });
module.exports = mongoose.model("HrShiftSettings", hrShiftSettingsSchema);