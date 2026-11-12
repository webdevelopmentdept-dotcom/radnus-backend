// models/AwardDefinition.js
// One document = one award or scheme for one period (e.g. "Best Performer - November 2026").
// It only REFERENCES KPI metrics by key. It never stores or changes KPI targets.
const mongoose = require('mongoose');
const C = require('../constants/awardMetrics');

const MetricSchema = new mongoose.Schema({
  metric_key: { type: String, required: true },
  weight: { type: Number, required: true, min: 0, max: 100 },
  target: { type: Number, default: null },   // optional override, null = use the KPI target
}, { _id: false });

const RewardSchema = new mongoose.Schema({
  rank_from: { type: Number, default: 1, min: 1 },
  rank_to: { type: Number, default: 1, min: 0 },   // 0 = every qualifying winner
  type: { type: String, enum: C.REWARD_TYPES, required: true },
  title: { type: String, default: '', maxlength: 80 },
  cash_amount: { type: Number, default: 0, min: 0 },
  points: { type: Number, default: 0, min: 0 },
}, { _id: false });

const AwardDefinitionSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 3, maxlength: 80 },
  description: { type: String, default: '', maxlength: 500 },

  category: { type: String, enum: C.CATEGORIES, required: true },
  frequency: { type: String, enum: C.FREQUENCIES, default: 'monthly' },
  participation: { type: String, enum: C.PARTICIPATIONS, default: 'individual' },
  departments: { type: [String], default: [] },

  departments: { type: [String], default: [] },            // [] = all departments
  employee_ids: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }], default: [] },   // ← NEW: individually chosen employees// [] = all departments

  start_date: { type: Date, required: true },
  end_date: { type: Date, required: true },

  rule_type: { type: String, enum: C.RULE_TYPES, default: 'weighted_score' },
  metrics: { type: [MetricSchema], default: [] },          // weighted_score only
  qualifying_rule: {                                         // qualifying_days only
    metric_key: { type: String, default: '' },
    min_daily_value: { type: Number, default: 0 },
    days_required: { type: Number, default: 0 },
    daily_kpi_names: { type: [String], default: [] },
  },

  eligibility: {
    min_kpi_percent: { type: Number, default: 0 },
    min_service_months: { type: Number, default: 0 },
    min_attendance_percent: { type: Number, default: 0 },
  },
  tie_breakers: { type: [String], default: [] },

  winners: {
    mode: { type: String, enum: C.WINNER_MODES, default: 'top_n' },
    count: { type: Number, default: 1, min: 0 },
  },
  rewards: { type: [RewardSchema], default: [] },
  budget: { total: { type: Number, default: 0, min: 0 } },

  approval_chain: { type: [String], default: ['hr', 'committee', 'management'] },
  counts_in_appraisal: { type: Boolean, default: false },
  basis: { type: String, enum: ['', 'kpi', 'whole_kpi', 'incentive', 'loan'], default: '' },   // what the scheme counts
  loan_count_on: { type: String, enum: ['paid', 'created'], default: 'paid' },                          // loan basis: count when paid or when created
  recognition_points: { type: Number, default: 0, min: 0 },

  status: { type: String, enum: C.STATUSES, default: 'draft', index: true },
  launched_at: { type: Date, default: null },
  closed_at: { type: Date, default: null },
  close_reason: { type: String, default: '' },
  cloned_from: { type: mongoose.Schema.Types.ObjectId, ref: 'AwardDefinition', default: null },

  created_by_name: { type: String, default: '' },
  updated_by_name: { type: String, default: '' },
}, { timestamps: true });

AwardDefinitionSchema.index({ start_date: -1 });
AwardDefinitionSchema.index({ category: 1, status: 1 });

module.exports = mongoose.models.AwardDefinition
  || mongoose.model('AwardDefinition', AwardDefinitionSchema);