// models/LifeGoalRevision.js  (collection: life_goal_revisions)
// Audit trail of goal edits. Money/notes changes are recorded as "changed" only (no values).
const mongoose = require('mongoose');

const revisionSchema = new mongoose.Schema({
  goal_id:        { type: mongoose.Schema.Types.ObjectId, ref: 'LifeGoal', required: true, index: true },
  employee_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  changed_fields: [{ type: String }],
  before:         { type: mongoose.Schema.Types.Mixed },
  after:          { type: mongoose.Schema.Types.Mixed },
  changed_by:     { type: String, required: true },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model('LifeGoalRevision', revisionSchema, 'life_goal_revisions');