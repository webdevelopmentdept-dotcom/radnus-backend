// constants/awardMetrics.js
// Single source of truth for Award Configuration (Phase 1).
// "source: auto"   -> Phase 2 will compute it from existing data (KPI, attendance, ...)
// "source: manual" -> committee types the score in during evaluation

const METRICS = [
  { key: 'kpi_achievement',       label: 'KPI achievement',            unit: '%',      source: 'auto' },
  { key: 'revenue',               label: 'Revenue achieved',           unit: '₹',      source: 'auto' },
  { key: 'lead_conversion',       label: 'Lead conversion',            unit: '%',      source: 'auto' },
  { key: 'collection',            label: 'Collection performance',     unit: '%',      source: 'auto' },
  { key: 'follow_up',             label: 'Follow-up discipline',       unit: '%',      source: 'auto' },
  { key: 'attendance',            label: 'Attendance',                 unit: '%',      source: 'auto' },
  { key: 'punctuality',           label: 'Punctuality',                unit: '%',      source: 'auto' },
  { key: 'peer_feedback',         label: 'Peer feedback',              unit: 'rating', source: 'auto' },
  { key: 'innovation_score',      label: 'Innovation score',           unit: 'pts',    source: 'auto' },
  { key: 'team_kpi',              label: 'Team KPI achievement',       unit: '%',      source: 'auto' },
  { key: 'improvement',           label: 'Improvement vs last period', unit: '%',      source: 'auto' },
  { key: 'daily_incentive_count', label: 'Daily incentive count',      unit: 'count',  source: 'auto' },
  { key: 'customer_feedback',     label: 'Customer feedback',          unit: 'rating', source: 'manual' },
  { key: 'committee_score',       label: 'Committee score',            unit: 'pts',    source: 'manual' },
];

const CATEGORIES = ['performance', 'behavioural', 'team', 'special_scheme'];
const FREQUENCIES = ['monthly', 'quarterly', 'yearly', 'one_time'];
const PARTICIPATIONS = ['individual', 'team'];
const RULE_TYPES = ['weighted_score', 'qualifying_days', 'manual_selection'];
const WINNER_MODES = ['top_n', 'all_qualifying'];
const REWARD_TYPES = [
  'trophy', 'gold_medal', 'silver_medal', 'bronze_medal', 'medal',
  'certificate', 'badge', 'gift_voucher', 'cash', 'points',
];
const TIE_BREAKERS = [
  'higher_kpi', 'higher_attendance', 'higher_revenue', 'longer_service', 'committee_decision',
];
const APPROVAL_STEPS = ['hr', 'committee', 'management']; // canonical order
const STATUSES = ['draft', 'active', 'closed'];

// Quick-start templates shown in the "Start from a template" dropdown.
// Dates are filled in by the admin. rank_to = 0 means "every qualifying winner".
const R = (rank_from, rank_to, type, title = '', extra = {}) =>
  ({ rank_from, rank_to, type, title, cash_amount: 0, points: 0, ...extra });

const PRESETS = [
  {
    name: 'Best Performer', category: 'performance', rule_type: 'weighted_score',
    description: 'Highest KPI achievement in the month.',
    metrics: [{ metric_key: 'kpi_achievement', weight: 100 }],
    eligibility: { min_kpi_percent: 80 },
    rewards: [R(1, 1, 'trophy', 'Best Performer trophy')],
  },
  {
    name: 'Best Revenue Generator', category: 'performance', rule_type: 'weighted_score',
    description: 'Highest eligible revenue.',
    metrics: [{ metric_key: 'revenue', weight: 100 }],
    eligibility: { min_kpi_percent: 80 },
    rewards: [R(1, 1, 'gold_medal', 'Gold medal')],
  },
  {
    name: 'Best Sales Performer', category: 'performance', rule_type: 'weighted_score',
    description: 'Balanced sales scorecard.',
    metrics: [
      { metric_key: 'revenue', weight: 40 }, { metric_key: 'lead_conversion', weight: 25 },
      { metric_key: 'collection', weight: 15 }, { metric_key: 'customer_feedback', weight: 10 },
      { metric_key: 'follow_up', weight: 10 },
    ],
    eligibility: { min_kpi_percent: 80 },
    winners: { mode: 'top_n', count: 3 },
    rewards: [R(1, 1, 'trophy'), R(2, 2, 'silver_medal'), R(3, 3, 'bronze_medal')],
  },
  {
    name: 'Best Team Player', category: 'behavioural', rule_type: 'weighted_score',
    description: 'Teamwork and peer feedback.',
    metrics: [{ metric_key: 'peer_feedback', weight: 60 }, { metric_key: 'committee_score', weight: 40 }],
    rewards: [R(1, 1, 'medal', 'Team player medal')],
  },
  {
    name: 'Best Attendance', category: 'behavioural', rule_type: 'weighted_score',
    description: 'Attendance and punctuality.',
    metrics: [{ metric_key: 'attendance', weight: 70 }, { metric_key: 'punctuality', weight: 30 }],
    eligibility: { min_attendance_percent: 95 },
    rewards: [R(1, 1, 'certificate')],
  },
  {
    name: 'Best Customer Support', category: 'behavioural', rule_type: 'weighted_score',
    description: 'Customer satisfaction.',
    metrics: [{ metric_key: 'customer_feedback', weight: 70 }, { metric_key: 'follow_up', weight: 30 }],
    rewards: [R(1, 1, 'trophy')],
  },
  {
    name: 'Best Innovation', category: 'behavioural', rule_type: 'weighted_score',
    description: 'Implemented valuable idea.',
    metrics: [{ metric_key: 'innovation_score', weight: 100 }],
    rewards: [R(1, 1, 'trophy')],
  },
  {
    name: 'Best Team Leader', category: 'behavioural', rule_type: 'weighted_score',
    description: 'Team achievement and leadership.',
    metrics: [{ metric_key: 'team_kpi', weight: 60 }, { metric_key: 'committee_score', weight: 40 }],
    rewards: [R(1, 1, 'trophy')],
  },
  {
    name: 'Most Improved Employee', category: 'performance', rule_type: 'weighted_score',
    description: 'Improvement against the previous period.',
    metrics: [{ metric_key: 'improvement', weight: 100 }],
    rewards: [R(1, 1, 'medal')],
  },
  {
    name: 'Best Department', category: 'team', rule_type: 'weighted_score', participation: 'team',
    description: 'Department KPI achievement.',
    metrics: [{ metric_key: 'team_kpi', weight: 100 }],
    rewards: [R(1, 1, 'trophy', 'Team trophy')],
  },
  {
    name: 'Consistent Performer', category: 'performance', rule_type: 'weighted_score',
    frequency: 'quarterly',
    description: 'Sustained performance across the quarter.',
    metrics: [{ metric_key: 'kpi_achievement', weight: 100 }],
    eligibility: { min_kpi_percent: 90 },
    rewards: [R(1, 1, 'certificate')],
  },
  {
    name: '20 Days Incentive Challenge', category: 'special_scheme', rule_type: 'qualifying_days',
    frequency: 'one_time',
    description: 'Earn at least 2 incentives a day on 20 days this month.',
    qualifying_rule: { metric_key: 'daily_incentive_count', min_daily_value: 2, days_required: 20 },
    winners: { mode: 'all_qualifying', count: 10 },
    rewards: [R(1, 1, 'trophy', 'Best performer trophy'), R(1, 0, 'certificate', 'Recognition certificate')],
  },
];

module.exports = {
  METRICS, CATEGORIES, FREQUENCIES, PARTICIPATIONS, RULE_TYPES, WINNER_MODES,
  REWARD_TYPES, TIE_BREAKERS, APPROVAL_STEPS, STATUSES, PRESETS,
};