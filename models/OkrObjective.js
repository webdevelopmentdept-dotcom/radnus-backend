// models/OkrObjective.js

const mongoose = require('mongoose');

const KeyResultSchema = new mongoose.Schema({
  title: { type: String, required: true },

  // Link to existing KPI Template item
  linked_kpi_name:     { type: String, default: null },
  linked_template_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'KpiTemplate', default: null },
  linked_kpi_item_id:  { type: mongoose.Schema.Types.ObjectId, default: null },

  target:   { type: Number, required: true },
  unit:     { type: String, default: '' },
  weight:   { type: Number, default: 0 }, // KR weight — all KRs should sum to 100

  current_value: { type: Number, default: 0 },
  progress_pct:  { type: Number, default: 0 }, // auto-calculated
}, { _id: true });

const OkrObjectiveSchema = new mongoose.Schema({
  title:      { type: String, required: true },
  description:{ type: String, default: '' },
  department: { type: String, required: true },
  quarter:    { type: String, default: '' },   // Q1 / Q2 / Q3 / Q4
  year:       { type: String, default: '' },
  status:     { type: String, enum: ['active', 'completed', 'archived'], default: 'active' },

  key_results: [KeyResultSchema],

  objective_score: { type: Number, default: 0 }, // weighted avg of KR progress
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'HR', default: null },
}, { timestamps: true });

// Auto-calculate objective_score before save
OkrObjectiveSchema.pre('save', function (next) {
  if (!this.key_results.length) { this.objective_score = 0; return next(); }

  // Recalculate each KR progress_pct
  this.key_results.forEach(kr => {
    kr.progress_pct = kr.target > 0
      ? Math.min(Math.round((kr.current_value / kr.target) * 100), 100)
      : 0;
  });

  // Weighted average → objective_score
  const totalWeight = this.key_results.reduce((s, kr) => s + (kr.weight || 0), 0);
  const eqW = 100 / this.key_results.length;
  let score = 0;
  this.key_results.forEach(kr => {
    const w = totalWeight === 0 ? eqW : (kr.weight || 0);
    score += kr.progress_pct * (w / 100);
  });
  this.objective_score = Math.round(score);
  next();
});

module.exports = mongoose.model('OkrObjective', OkrObjectiveSchema);