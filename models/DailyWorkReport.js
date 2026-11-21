const mongoose = require("mongoose");

const dailyWorkReportSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  date: { type: String, required: true },
  work_mode: { type: String, enum: ["office", "wfh"], default: "office" },

  plan_submitted_at: { type: Date, default: null },
  eod_submitted_at: { type: Date, default: null },
  eod_updated_at: { type: Date, default: null },
  eod_late: { type: Boolean, default: false },
  summary: { type: String, default: "" },

  totals: {
    total: { type: Number, default: 0 },
    completed: { type: Number, default: 0 },
    partial: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
  },
  score: { type: Number, default: null },             // 0-100

  // Step 5 la TL/HR review
  review_status: { type: String, enum: ["pending", "accepted", "rework"], default: "pending" },
  reviewer_name: { type: String, default: "" },
  review_note: { type: String, default: "" },
  reviewed_at: { type: Date, default: null },
}, { timestamps: true });

dailyWorkReportSchema.index({ employee_id: 1, date: 1 }, { unique: true });

module.exports = mongoose.model("DailyWorkReport", dailyWorkReportSchema);