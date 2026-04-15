const mongoose = require("mongoose");

const AttendanceSchema = new mongoose.Schema({
  employee_id:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  date:          { type: String, required: true },
  status:        { type: String, enum: ["present","absent","late","half_day","leave","holiday","weekend"], default: "present" },
  checkIn:       { type: Date },
  checkOut:      { type: Date },
  breakStart:    { type: Date },
  breakEnd:      { type: Date },
  break_minutes: { type: Number, default: 0 },
  work_hours:    { type: Number, default: 0 },
  shift:         { type: String, default: "General (9:45 AM – 7:00 PM)" },
  method:        { type: String, enum: ["manual","hr_manual","auto","qr"], default: "manual" },
  location:      { lat: Number, lng: Number },
  remark:        { type: String, default: "" },
}, { timestamps: true });

AttendanceSchema.index({ employee_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);