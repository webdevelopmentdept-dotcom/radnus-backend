const mongoose = require('mongoose');

const kpiLeaderMappingSchema = new mongoose.Schema({
  leader_id:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  member_ids: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  isActive:   { type: Boolean, default: true },
  // What this team leader can do for the team. Missing field on old docs = both allowed.
  permissions: {
    kpi_view:       { type: Boolean, default: true },
    leave_approval: { type: Boolean, default: true },
  },
  // Life Growth: when true, members of this team may share a goal with this leader.
  // Default FALSE (private by default). Kept outside `permissions` on purpose, so the
  // existing HR team-edit code (which rewrites `permissions`) can never overwrite it.
  growth_review_enabled: { type: Boolean, default: false },
  created_by: { type: String, default: 'hr' },
}, { timestamps: true });

// One active mapping per leader
kpiLeaderMappingSchema.index(
  { leader_id: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('KpiLeaderMapping', kpiLeaderMappingSchema);