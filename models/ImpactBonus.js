const mongoose = require('mongoose');

const impactBonusSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee', required: true
  },

  // Submission details
  title: { type: String, required: true },
  description: { type: String, required: true },
  impact_areas: [{
    type: String,
    enum: ['revenue_growth','cost_reduction','product_innovation',
           'customer_satisfaction','brand_visibility','employee_engagement']
  }],
  submission_channel: {
    type: String,
    enum: ['hr_desk', 'lms_portal'],
    default: 'hr_desk'
  },

  // Eligibility
  employee_level: { type: String }, // L1-L3, L4-L6, L7-L10
  contribution_type: { type: String },

  // Tier
  impact_tier: {
    type: String,
    enum: ['tier1_local', 'tier2_cross', 'tier3_company'],
    default: 'tier1_local'
  },

  // Scoring (100 pts total)
  scoring: {
    innovation_originality:    { type: Number, default: 0, min: 0, max: 25 },
    measurable_business_result:{ type: Number, default: 0, min: 0, max: 35 },
    scalability:               { type: Number, default: 0, min: 0, max: 20 },
    team_collaboration_speed:  { type: Number, default: 0, min: 0, max: 20 },
  },
  total_score: { type: Number, default: 0 },

  // Bonus
  bonus_amount: { type: Number, default: 0 },
  bonus_approved: { type: Boolean, default: false },
  approved_by: { type: String }, // CPO + CEO

  // Recognition
  certificate_issued: { type: Boolean, default: false },
  featured_in_digest: { type: Boolean, default: false },
  esop_eligible:      { type: Boolean, default: false },
  impact_wall:        { type: Boolean, default: false },

  // Status pipeline
  status: {
    type: String,
    enum: ['submitted','dept_review','iec_review','scoring','approved','announced','rejected'],
    default: 'submitted'
  },

  dept_head_comment: { type: String },
  iec_comment:       { type: String },
  rejection_reason:  { type: String },

  period: { type: String }, // e.g. "Q1 2026"
  announced_at: { type: Date },

}, { timestamps: true });

// Auto calculate total score
impactBonusSchema.pre('save', function(next) {
  const s = this.scoring;
  this.total_score = (s.innovation_originality || 0) +
                     (s.measurable_business_result || 0) +
                     (s.scalability || 0) +
                     (s.team_collaboration_speed || 0);
  next();
});

module.exports = mongoose.model('ImpactBonus', impactBonusSchema);