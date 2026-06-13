// models/IncentiveResult.js
const mongoose = require("mongoose");

const IncentiveResultSchema = new mongoose.Schema({
  employee_id:       { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  plan_id:           { type: mongoose.Schema.Types.ObjectId, ref: "IncentivePlan" },
  assignment_id:     { type: mongoose.Schema.Types.ObjectId, ref: "IncentiveAssignment" },

  performance_score: { type: Number, default: 0 },
  salary:            { type: Number, default: 0 },
  calculated_amount: { type: Number, default: 0 },
  completion_bonus:       { type: Number, default: 0 },
  completion_bonus_label: { type: String, default: "" },

  // ── ADD THIS ──
  kpi_breakdown: { type: Array, default: [] },

  cycle:        { type: String, default: "Monthly" },
  cycle_period: { type: String },
  status:       { type: String, enum: ["pending", "approved", "paid"], default: "pending" },
  // ADD THESE 4 LINES after status field:
hr_review_requested:     { type: Boolean, default: false },
hr_review_requested_at:  { type: Date },
hr_review_note:          { type: String, default: "" },
hr_review_remark:        { type: String, default: "" },
employee_submitted_value:{ type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model("IncentiveResult", IncentiveResultSchema);