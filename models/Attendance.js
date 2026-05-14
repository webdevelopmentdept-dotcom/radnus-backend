const mongoose = require("mongoose");

// ── Single punch entry ────────────────────────────────────────
const PunchSchema = new mongoose.Schema({
  type:      { type: String, enum: ["in", "out"], required: true },
  time:      { type: Date, required: true },
  method:    { type: String, enum: ["manual", "hr_manual", "auto", "qr"], default: "manual" },
  location:  { lat: Number, lng: Number },
  remark:    { type: String, default: "" },
}, { _id: true });

// ── Main Attendance Schema ────────────────────────────────────
const AttendanceSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
  },
  date:   { type: String, required: true }, // "YYYY-MM-DD"
  shift:  { type: String, default: "General (9:45 AM – 7:00 PM)" },
  remark: { type: String, default: "" },

  // ── NEW: All punches for the day ──────────────────────────
  // Pattern: in → out → in → out → ...
  // Example:
  //   09:46 in
  //   11:30 out  (left office)
  //   13:00 in   (came back)
  //   19:00 out  (final checkout)
  punches: [PunchSchema],

  // ── Computed / cached fields (updated on every punch) ─────
  // These are derived from punches[] — stored for query speed
  status:            {
    type: String,
    enum: ["present", "absent", "late", "half_day", "leave", "holiday", "weekend"],
    default: "absent",
  },
  first_in:          { type: Date },   // first "in" punch of the day
  last_out:          { type: Date },   // last "out" punch of the day
  work_hours:        { type: Number, default: 0 },   // net work hours (sum of in→out pairs)
  break_minutes:     { type: Number, default: 0 },   // total break time between punches
  late_minutes:      { type: Number, default: 0 },   // mins after 10:00 AM grace
  early_out_minutes: { type: Number, default: 0 },   // mins before 7:00 PM (based on last_out)
  overtime_minutes:  { type: Number, default: 0 },   // mins after 7:00 PM (based on last_out)

  // ── HR override fields ────────────────────────────────────
  method:   { type: String, enum: ["manual", "hr_manual", "auto", "qr"], default: "manual" },

  // ── Legacy fields (kept for backward compat during migration) ──
  // Remove these after migration is complete
  checkIn:    { type: Date },
  checkOut:   { type: Date },
  breakStart: { type: Date },
  breakEnd:   { type: Date },

}, { timestamps: true });

AttendanceSchema.index({ employee_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("Attendance", AttendanceSchema);