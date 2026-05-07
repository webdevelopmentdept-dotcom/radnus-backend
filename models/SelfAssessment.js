const mongoose = require('mongoose');

// ✅ FIX: weight, is_admission_kpi, program_targets fields added
const selfAssessmentItemSchema = new mongoose.Schema({
  kpi_item_id:      { type: String, required: true },
  kpi_name:         { type: String, required: true },
  target:           { type: Number, required: true },
  unit:             { type: String },
  weight:           { type: Number, default: 0 },        // ✅ ADDED
  is_admission_kpi: { type: Boolean, default: false },   // ✅ ADDED
  program_targets:  { type: Array, default: [] },        // ✅ ADDED
  self_value:       { type: Number, required: true },
  self_comment:     { type: String },
  hr_value:         { type: Number },
  hr_comment:       { type: String }
});

const selfAssessmentSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  assignment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KpiAssignment',
    required: true
  },
  period:          { type: String, required: true },
  items:           [selfAssessmentItemSchema],
  overall_comment: { type: String },
  status: {
    type: String,
    enum: ['submitted', 'reviewed'],
    default: 'submitted'
  },
  // HR Review Fields
  hr_final_score:     { type: Number },
  hr_rating:          { type: String },
  hr_overall_comment: { type: String },
  reviewed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  reviewed_at: { type: Date },
  // Performance review update field
  final_score: { type: Number },
}, { timestamps: true });

// ✅ OverwriteModelError prevent — already compiled-ஆ இருந்தா reuse பண்ணு
module.exports = mongoose.models.SelfAssessment ||
  mongoose.model('SelfAssessment', selfAssessmentSchema);