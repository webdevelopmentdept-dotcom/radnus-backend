// helpers/awardDefinitionValidator.js
// Pure functions (no DB). Cleans the request body and returns friendly errors.
//   validateAward(body)                      -> lenient, used when saving a draft
//   validateAward(body, { forLaunch: true }) -> strict, used when launching
const C = require('../constants/awardMetrics');

const METRIC_LABEL = Object.fromEntries(C.METRICS.map((m) => [m.key, m.label]));
const ORDER = C.APPROVAL_STEPS;

const toDateStr = (v) => {
  if (!v) return '';
  if (v instanceof Date) return isNaN(v) ? '' : v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
const isDateStr = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(`${s}T00:00:00.000Z`));
const toDate = (s) => new Date(`${s}T00:00:00.000Z`);
const num = (v, fallback = 0) => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};
const int = (v, fallback = 0) => Math.floor(num(v, fallback));
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

// Today in India as YYYY-MM-DD (so "ended yesterday" is judged by IST, not UTC)
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

function validateAward(input = {}, { forLaunch = false } = {}) {
  const errors = [];
  const warnings = [];
  const d = {};

  const pick = (field, value, list, fallback) => {
    if (value === undefined || value === null || value === '') return fallback;
    if (!list.includes(value)) { errors.push(`"${value}" is not a valid ${field}`); return fallback; }
    return value;
  };

  // ── Basics ────────────────────────────────────────────────────────────────
  d.name = String(input.name || '').trim();
  if (d.name.length < 3 || d.name.length > 80) errors.push('Name must be 3 to 80 characters');
  d.description = String(input.description || '').trim().slice(0, 500);
  d.category = pick('category', input.category, C.CATEGORIES, undefined);
  if (!d.category) errors.push('Choose a category');
  d.frequency = pick('frequency', input.frequency, C.FREQUENCIES, 'monthly');
  d.participation = pick('participation', input.participation, C.PARTICIPATIONS, 'individual');
  d.rule_type = pick('rule type', input.rule_type, C.RULE_TYPES, 'weighted_score');

  const seenDept = new Set();
  d.departments = (Array.isArray(input.departments) ? input.departments : [])
    .map((x) => String(x || '').trim())
    .filter((x) => x && !seenDept.has(x) && seenDept.add(x));

  const seenEmp = new Set();
  d.employee_ids = (Array.isArray(input.employee_ids) ? input.employee_ids : [])
  .map((x) => String(x || '').trim())
    .filter((x) => /^[a-f\d]{24}$/i.test(x) && !seenEmp.has(x) && seenEmp.add(x))
    .slice(0, 500); 

      d.basis = ['kpi', 'whole_kpi', 'incentive', 'loan'].includes(input.basis) ? input.basis : '';
  d.loan_count_on = input.loan_count_on === 'created' ? 'created' : 'paid';


  // ── Period ────────────────────────────────────────────────────────────────
  const sd = toDateStr(input.start_date);
  const ed = toDateStr(input.end_date);
  let spanDays = null;
  if (!isDateStr(sd)) errors.push('Choose a start date');
  if (!isDateStr(ed)) errors.push('Choose an end date');
  if (isDateStr(sd) && isDateStr(ed)) {
    if (ed < sd) errors.push('End date must be on or after the start date');
    else spanDays = Math.round((toDate(ed) - toDate(sd)) / 86400000) + 1;
    d.start_date = toDate(sd);
    d.end_date = toDate(ed);
  }

  // ── How winners are chosen ───────────────────────────────────────────────
  d.metrics = [];
  d.qualifying_rule = { metric_key: '', min_daily_value: 0, days_required: 0 };

  if (d.rule_type === 'weighted_score') {
    const seen = new Set();
    for (const m of Array.isArray(input.metrics) ? input.metrics : []) {
      const key = String(m?.metric_key || '').trim();
      if (!METRIC_LABEL[key]) { errors.push(`Unknown metric "${key}"`); continue; }
      if (seen.has(key)) { errors.push(`${METRIC_LABEL[key]} is added twice`); continue; }
      seen.add(key);
      const weight = num(m.weight);
      if (weight <= 0 || weight > 100) errors.push(`${METRIC_LABEL[key]} weight must be between 1 and 100`);
      const target = (m.target === '' || m.target === null || m.target === undefined) ? null : num(m.target, null);
      if (target !== null && target < 0) errors.push(`${METRIC_LABEL[key]} target cannot be negative`);
      d.metrics.push({ metric_key: key, weight, target });
    }
    const total = Math.round(d.metrics.reduce((s, m) => s + m.weight, 0) * 100) / 100;
    if (forLaunch && !d.metrics.length) errors.push('Add at least one metric');
    else if (d.metrics.length && Math.abs(total - 100) > 0.01) {
      const msg = `Metric weights add up to ${total}. They must add up to 100`;
      (forLaunch ? errors : warnings).push(msg);
    }
    if (d.metrics.some((m) => C.METRICS.find((x) => x.key === m.metric_key)?.source === 'manual')) {
      warnings.push('Some metrics are scored manually. The committee will enter these during evaluation');
    }
  }

  if (d.rule_type === 'qualifying_days') {
    const q = input.qualifying_rule || {};
    const key = String(q.metric_key || '').trim();
    if (key && !METRIC_LABEL[key]) errors.push(`Unknown metric "${key}"`);
        d.qualifying_rule = {
      metric_key: METRIC_LABEL[key] ? key : '',
      min_daily_value: num(q.min_daily_value),
      days_required: int(q.days_required),
      daily_kpi_names: [...new Set((Array.isArray(q.daily_kpi_names) ? q.daily_kpi_names : [])
        .map((s) => String(s).trim()).filter(Boolean))].slice(0, 20),
    };
    const { metric_key, min_daily_value, days_required } = d.qualifying_rule;
    if (min_daily_value < 0) errors.push('Daily minimum cannot be negative');
    if (days_required < 0) errors.push('Qualifying days cannot be negative');
    if (days_required > 0 && spanDays !== null && days_required > spanDays) {
      errors.push(`Qualifying days (${days_required}) is more than the days in the period (${spanDays})`);
    }
    if (forLaunch && (!metric_key || min_daily_value <= 0 || days_required <= 0)) {
      errors.push('Set the metric, the daily minimum and the number of qualifying days');
    }
        if (forLaunch && !d.qualifying_rule.daily_kpi_names.length) {
      warnings.push('No Daily Log KPI chosen. Employees who record daily numbers in Daily Log will show zero. Loan and incentive-entry employees are not affected.');
    }
  }

  // ── Eligibility and tie-breakers ──────────────────────────────────────────
  const el = input.eligibility || {};
  d.eligibility = {
    min_kpi_percent: num(el.min_kpi_percent),
    min_service_months: num(el.min_service_months),
    min_attendance_percent: num(el.min_attendance_percent),
  };
  if (d.eligibility.min_kpi_percent < 0 || d.eligibility.min_kpi_percent > 200) errors.push('Minimum KPI must be between 0 and 200');
  if (d.eligibility.min_attendance_percent < 0 || d.eligibility.min_attendance_percent > 100) errors.push('Minimum attendance must be between 0 and 100');
  if (d.eligibility.min_service_months < 0 || d.eligibility.min_service_months > 600) errors.push('Minimum service must be between 0 and 600 months');

  const seenTb = new Set();
  d.tie_breakers = [];
  for (const t of Array.isArray(input.tie_breakers) ? input.tie_breakers : []) {
    if (!C.TIE_BREAKERS.includes(t)) { errors.push(`"${t}" is not a valid tie-breaker`); continue; }
    if (!seenTb.has(t)) { seenTb.add(t); d.tie_breakers.push(t); }
  }

  // ── Winners ───────────────────────────────────────────────────────────────
  const w = input.winners || {};
  const mode = pick('winner mode', w.mode, C.WINNER_MODES, 'top_n');
  const count = int(w.count, mode === 'top_n' ? 1 : 0);
  if (mode === 'top_n' && count < 1) errors.push('Number of winners must be at least 1');
  if (count < 0) errors.push('Number of winners cannot be negative');
  d.winners = { mode, count: Math.max(count, 0) };

  // ── Rewards ───────────────────────────────────────────────────────────────
  d.rewards = [];
  let estimatedCash = 0;
  (Array.isArray(input.rewards) ? input.rewards : []).forEach((r, i) => {
    const n = i + 1;
    const type = pick(`reward type (reward ${n})`, r?.type, C.REWARD_TYPES, undefined);
    if (!type) { errors.push(`Choose a reward type for reward ${n}`); return; }
    const rank_from = int(r.rank_from, 1);
    const rank_to = int(r.rank_to, rank_from);
    if (rank_from < 1) errors.push(`Reward ${n}: first rank must be at least 1`);
    if (rank_to < 0 || (rank_to > 0 && rank_to < rank_from)) errors.push(`Reward ${n}: last rank must be 0 (all winners) or at least the first rank`);
    const cash_amount = type === 'cash' ? num(r.cash_amount) : 0;
    const points = type === 'points' ? int(r.points) : 0;
    if (cash_amount < 0 || points < 0) errors.push(`Reward ${n}: amounts cannot be negative`);
    if (type === 'cash' && cash_amount <= 0) (forLaunch ? errors : warnings).push(`Reward ${n}: enter a cash amount`);
    if (type === 'points' && points <= 0) (forLaunch ? errors : warnings).push(`Reward ${n}: enter the points`);
    if (d.winners.mode === 'top_n' && d.winners.count && rank_from > d.winners.count) {
      (forLaunch ? errors : warnings).push(`Reward ${n} is for rank ${rank_from}, but only ${d.winners.count} winner(s) are chosen`);
    }
    const people = rank_to > 0 ? (rank_to - rank_from + 1) : d.winners.count;
    if (type === 'cash') estimatedCash += cash_amount * Math.max(people, 0);
    d.rewards.push({ rank_from, rank_to, type, title: String(r.title || '').trim().slice(0, 80), cash_amount, points });
  });
  if (forLaunch && !d.rewards.length) errors.push('Add at least one reward');

  // ── Budget ────────────────────────────────────────────────────────────────
  const total = num(input.budget?.total ?? input.budget);
  if (total < 0) errors.push('Budget cannot be negative');
  d.budget = { total: Math.max(total, 0) };
  if (estimatedCash > 0 && d.budget.total === 0) warnings.push(`No budget set. Estimated cash rewards are ${inr(estimatedCash)}`);
  if (d.budget.total > 0 && estimatedCash > d.budget.total) {
    const msg = `Estimated cash rewards (${inr(estimatedCash)}) are more than the budget (${inr(d.budget.total)})`;
    (forLaunch ? errors : warnings).push(msg);
  }

  // ── Approval and appraisal ────────────────────────────────────────────────
  const chainIn = Array.isArray(input.approval_chain) && input.approval_chain.length ? input.approval_chain : ORDER;
  chainIn.forEach((s) => { if (!ORDER.includes(s)) errors.push(`"${s}" is not a valid approval step`); });
  d.approval_chain = ORDER.filter((s) => chainIn.includes(s));
  if (!d.approval_chain.length) errors.push('Choose at least one approval step');

  d.counts_in_appraisal = !!input.counts_in_appraisal;
  d.recognition_points = d.counts_in_appraisal ? int(input.recognition_points) : 0;
  if (d.recognition_points < 0 || d.recognition_points > 100) errors.push('Recognition points must be between 0 and 100');
    if (d.counts_in_appraisal) {
    const keys = (d.metrics || []).map((m) => m.metric_key);
    if (keys.includes('innovation_score')) {
      warnings.push('This award uses the innovation score, which already counts in the Recognition score. Its points will NOT be added to the appraisal.');
    } else if (keys.some((k) => ['kpi_achievement', 'revenue', 'lead_conversion', 'collection', 'follow_up', 'team_kpi', 'improvement'].includes(k))) {
      warnings.push('This award is decided by KPI data that already counts in the appraisal. Keep its points small so the same performance is not rewarded twice.');
    }
  }

  // ── Launch-only date rule ─────────────────────────────────────────────────
  if (forLaunch) {
    if (d.rule_type === 'qualifying_days' && !d.basis) errors.push('Choose what this scheme is based on: a KPI, incentive or loan.');
    if (['kpi', 'incentive', 'loan'].includes(d.basis) && d.rule_type !== 'qualifying_days') errors.push('This basis works with a qualifying-days scheme.');
    if (d.basis === 'kpi' && !(d.qualifying_rule?.daily_kpi_names || []).length) errors.push('Pick at least one KPI to count.');
    if (d.basis === 'whole_kpi' && !(d.rule_type === 'weighted_score' && (d.metrics || []).some((m) => m.metric_key === 'kpi_achievement'))) {
      errors.push('KPI performance awards rank by KPI achievement.');
    }
  }
  
  return { errors, warnings, data: d, estimatedCash };
}

module.exports = { validateAward, toDateStr, todayIST };