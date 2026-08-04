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
employee_submitted_value:{ type: Number, default: 0 },   // 🔧 now auto-computed = sum of sale_entries

// 🆕 STEP 1: Cumulative sale entries (Option C)
sale_entries: {
  type: [{
    amount:    { type: Number, required: true },
    date:      { type: Date,   default: Date.now },
    note:      { type: String, default: "" },
    added_by:  { type: String, enum: ["employee", "hr"], default: "employee" },
    added_at:  { type: Date,   default: Date.now },
  }],
  default: [],
},
period_locked:    { type: Boolean, default: false },
period_locked_at: { type: Date },

}, { timestamps: true });

module.exports = mongoose.model("IncentiveResult", IncentiveResultSchema);