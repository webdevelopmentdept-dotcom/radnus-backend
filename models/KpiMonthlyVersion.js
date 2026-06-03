const mongoose = require('mongoose');

const programTargetSchema = new mongoose.Schema({
  program_id:   { type: String },
  program_name: { type: String },
  target:       { type: Number, default: 0 }
}, { _id: false });

const kpiItemSchema = new mongoose.Schema({
  kpi_name:         { type: String, required: true },
  target:           { type: Number, default: 0 },
  unit:             { type: String, default: 'tasks' },
  weight:           { type: Number, default: 0 },
  frequency:        { type: String, default: 'monthly' },
  owner_role:       { type: String, default: 'self' },
  is_admission_kpi: { type: Boolean, default: false },
  program_targets:  [programTargetSchema]
}, { _id: false });

const kpiMonthlyVersionSchema = new mongoose.Schema({
  template_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'KpiTemplate', required: true },
  month:        { type: String, required: true },        // e.g. "June 2026"
  month_status: { type: String, enum: ['draft', 'active', 'locked'], default: 'active' },
  kpi_items:    [kpiItemSchema],
  total_weight: { type: Number, default: 0 },
  locked_at:    { type: Date }
}, {
  timestamps: true
});

// Compound index - one version per template per month
kpiMonthlyVersionSchema.index({ template_id: 1, month: 1 }, { unique: true });

module.exports = mongoose.model('KpiMonthlyVersion', kpiMonthlyVersionSchema);