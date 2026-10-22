// models/LifeGoalShare.js  (collection: life_goal_shares)
// The EMPLOYEE decides who sees a goal (Team Lead and/or HR) and how much (summary or full).
const mongoose = require('mongoose');

const shareSchema = new mongoose.Schema({
  goal_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'LifeGoal', required: true, index: true },
  employee_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  // 'team_lead' -> grantee_id is the Team Lead (Employee). 'hr' -> no grantee_id (HR is a shared login).
  grantee_type: { type: String, enum: ['team_lead', 'hr'], default: 'team_lead' },
  grantee_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', index: true,
                  required: function () { return this.grantee_type !== 'hr'; } },
  scope:        { type: String, enum: ['summary', 'full'], default: 'summary' },
  active:       { type: Boolean, default: true },
  granted_at:   { type: Date, default: Date.now },
  revoked_at:   { type: Date, default: null },
}, { timestamps: true });

// one active share per goal per recipient (HR rows have no grantee_id, so one per goal)
shareSchema.index(
  { goal_id: 1, grantee_id: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);

module.exports = mongoose.model('LifeGoalShare', shareSchema, 'life_goal_shares');