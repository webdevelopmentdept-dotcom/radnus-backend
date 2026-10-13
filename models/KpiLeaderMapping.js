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
  created_by: { type: String, default: 'hr' },
}, { timestamps: true });

// One active mapping per leader
kpiLeaderMappingSchema.index(
  { leader_id: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('KpiLeaderMapping', kpiLeaderMappingSchema);