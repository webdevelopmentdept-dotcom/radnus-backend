// models/LifeGoal.js  (collection: employee_life_goals)
// Money fields and notes are stored encrypted (see helpers/lifeGrowthCrypto.js).
const mongoose = require('mongoose');

const ACTIVE = ['planned', 'in_progress', 'paused'];

const lifeGoalSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, index: true },
  roadmap_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'LifeVision', required: true, index: true },

  // null for custom goals. Title/description below are SNAPSHOTS, so later catalogue edits never change history.
  catalogue_goal_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LifeGoalCatalogue', default: null },
  stage_number:      { type: Number, min: 1, max: 5, default: null },

  title:       { type: String, required: true, maxlength: 120 },
  description: { type: String, default: '', maxlength: 1000 },
  category:    { type: String, required: true },

  is_primary:         { type: Boolean, default: false },
  // true only while this is the stage's live primary goal. Drives the unique index below.
  is_current_primary: { type: Boolean, default: false },
  priority:           { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },

  start_date:  { type: Date, required: true },
  target_date: { type: Date, required: true },

  // encrypted (AES-256-GCM). Amount is stored in paise as encrypted text.
  target_amount_enc:        { type: String, default: null },
  monthly_contribution_enc: { type: String, default: null },
  notes_enc:                { type: String, default: null },

  current_progress: { type: Number, min: 0, max: 100, default: 0 },
  next_action:      { type: String, default: '', maxlength: 300 },

  status:     { type: String, enum: ['planned', 'in_progress', 'completed', 'paused', 'revised', 'cancelled'], default: 'planned' },
  visibility: { type: String, enum: ['private', 'shared'], default: 'private' },

  carried_from_goal_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'LifeGoal', default: null },
  superseded_by_goal_id: { type: mongoose.Schema.Types.ObjectId, ref: 'LifeGoal', default: null },
  completed_at: { type: Date },
}, { timestamps: true });

lifeGoalSchema.pre('validate', function () {
  this.is_current_primary = !!(this.is_primary && this.stage_number && ACTIVE.includes(this.status));
});

// one live primary goal per stage per roadmap
lifeGoalSchema.index(
  { roadmap_id: 1, stage_number: 1 },
  { unique: true, partialFilterExpression: { is_current_primary: true } }
);

module.exports = mongoose.model('LifeGoal', lifeGoalSchema, 'employee_life_goals');