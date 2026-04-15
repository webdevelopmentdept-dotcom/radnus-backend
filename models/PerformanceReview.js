const mongoose = require('mongoose');

const reviewItemSchema = new mongoose.Schema({
  kpi_item_id: { type: String, required: true },
  kpi_name: { type: String, required: true },
  target: { type: Number, required: true },
  unit: { type: String },
  weight: { type: Number, required: true },
  self_value: { type: Number },
  actual_value: { type: Number },
  self_comment: { type: String }
});

const performanceReviewSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  assignment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'KpiAssignment', required: true },
  self_assessment_id: { type: mongoose.Schema.Types.ObjectId, ref: 'SelfAssessment' },
  period: { type: String, required: true },
  kpi_breakdown: [reviewItemSchema],
  final_score: { type: Number },
  rating: { type: String },
  hr_comment: { type: String },
  reviewed_by: { type: mongoose.Schema.Types.ObjectId, ref: 'HR' },
  status: { type: String, enum: ['draft', 'finalized'], default: 'finalized' }
}, { timestamps: true });

module.exports = mongoose.model('PerformanceReview', performanceReviewSchema);