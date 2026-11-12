// models/AwardWorkflow.js  approval trail for one award's finalized results
const mongoose = require('mongoose');
const C = require('../constants/awardMetrics');

const StepSchema = new mongoose.Schema({
  step:    { type: String, enum: C.APPROVAL_STEPS, required: true },
  status:  { type: String, enum: ['pending', 'approved', 'returned'], default: 'pending' },
  by:      { type: String, default: '' },
  by_role: { type: String, default: '' },
  at:      { type: Date, default: null },
  remark:  { type: String, default: '' },
  members: { type: [String], default: [] },          // committee members present
}, { _id: false });

const AwardWorkflowSchema = new mongoose.Schema({
  award_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AwardDefinition', required: true, unique: true },
  status:   { type: String, enum: ['in_review', 'approved', 'returned', 'published'], default: 'in_review' },
  steps:    { type: [StepSchema], default: [] },
  submitted_by: { type: String, default: '' },
  submitted_at: { type: Date, default: null },
  published_at: { type: Date, default: null },
  published_by: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.AwardWorkflow || mongoose.model('AwardWorkflow', AwardWorkflowSchema);