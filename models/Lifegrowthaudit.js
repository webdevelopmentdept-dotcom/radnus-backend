// models/LifeGrowthAudit.js  (collection: life_growth_audit)
// Who did/accessed what. Never store goal text or amounts here.
const mongoose = require('mongoose');

const auditSchema = new mongoose.Schema({
  actor_id:    { type: String, required: true },
  actor_role:  { type: String, default: 'employee' },
  action:      { type: String, required: true, index: true },
  target_type: { type: String, default: '' },
  target_id:   { type: String, default: '' },
  employee_id: { type: String, default: '', index: true },
  meta:        { type: mongoose.Schema.Types.Mixed },
}, { timestamps: { createdAt: true, updatedAt: false } });

module.exports = mongoose.model('LifeGrowthAudit', auditSchema, 'life_growth_audit');