// helpers/metricResolvers.js
// Each resolver returns Map<employeeIdString, rawNumber>. An employee with no data is simply absent.
const PerformanceReview = require('../models/PerformanceReview');
const Attendance = require('../models/Attendance');
const FeedbackCycle = require('../models/Feedbackcycle');
const FeedbackSubmission = require('../models/FeedbackSubmission');
const EmployeeAward = require('../models/EmployeeAward');
const DailyLog = require('../models/DailyLog');
const { KPI_KEYWORDS, DAILY_INCENTIVE_KEYWORDS } = require('../constants/awardMetricMap');

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

// Metrics that have no natural 0-100 scale. They are scored against the best participant.
const ABSOLUTE = new Set(['revenue', 'daily_incentive_count', 'innovation_score']);
const isAbsolute = (key) => ABSOLUTE.has(key);

// "2026-11-01" .. "2026-11-30" -> ["November 2026"]   (PerformanceReview.period format)
function periodsBetween(startStr, endStr) {
  const out = [];
  let y = Number(startStr.slice(0, 4)), m = Number(startStr.slice(5, 7)) - 1;
  const ey = Number(endStr.slice(0, 4)), em = Number(endStr.slice(5, 7)) - 1;
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${MONTHS[m]} ${y}`);
    if (++m > 11) { m = 0; y++; }
  }
  return out;
}
// Same number of months, immediately before the award period
function previousPeriods(startStr, endStr) {
  const n = periodsBetween(startStr, endStr).length;
  let y = Number(startStr.slice(0, 4)), m = Number(startStr.slice(5, 7)) - 1;
  const out = [];
  for (let i = 0; i < n; i++) {
    if (--m < 0) { m = 11; y--; }
    out.unshift(`${MONTHS[m]} ${y}`);
  }
  return out;
}

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const nameMatches = (kpiName, keywords) => {
  const n = norm(kpiName);
  return keywords.some((k) => n.includes(norm(k)));
};
const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

async function loadReviews(ids, periods) {
  if (!periods.length) return new Map();
  const rows = await PerformanceReview.find({
    employee_id: { $in: ids }, period: { $in: periods },
    status: 'finalized', final_score: { $ne: null },
  }).select('employee_id final_score kpi_breakdown').lean();
  const map = new Map();
  rows.forEach((r) => {
    const k = String(r.employee_id);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  });
  return map;
}

// ── individual resolvers ────────────────────────────────────────────────────
async function kpiAchievement(ctx) {
  const reviews = await loadReviews(ctx.ids, ctx.periods);
  const out = new Map();
  reviews.forEach((list, k) => out.set(k, avg(list.map((r) => r.final_score))));
  return out;
}

async function improvement(ctx) {
  const [cur, prev] = await Promise.all([
    loadReviews(ctx.ids, ctx.periods), loadReviews(ctx.ids, ctx.prevPeriods),
  ]);
  const out = new Map();
  cur.forEach((list, k) => {
    const p = prev.get(k);
    if (p) out.set(k, avg(list.map((r) => r.final_score)) - avg(p.map((r) => r.final_score)));
  });
  return out;
}

// revenue (sum of actuals) or percent-type KPI (sum actual / sum target * 100)
function kpiMapped(key) {
  return async (ctx) => {
    const reviews = await loadReviews(ctx.ids, ctx.periods);
    const keywords = KPI_KEYWORDS[key] || [];
    const out = new Map();
    reviews.forEach((list, k) => {
      let actual = 0, target = 0, found = false;
      list.forEach((r) => (r.kpi_breakdown || []).forEach((i) => {
        if (!nameMatches(i.kpi_name, keywords) || typeof i.actual_value !== 'number') return;
        found = true;
        actual += i.actual_value;
        target += Number(i.target) || 0;
      }));
      if (!found) return;
      if (isAbsolute(key)) out.set(k, actual);
      else if (target > 0) out.set(k, (actual / target) * 100);
    });
    return out;
  };
}

async function attendanceCounts(ctx) {
  const rows = await Attendance.aggregate([
    { $match: { employee_id: { $in: ctx.ids }, date: { $gte: ctx.startStr, $lte: ctx.endEffStr } } },
    { $group: { _id: { e: '$employee_id', s: '$status' }, n: { $sum: 1 } } },
  ]);
  const map = new Map();
  rows.forEach(({ _id, n }) => {
    const k = String(_id.e);
    if (!map.has(k)) map.set(k, {});
    map.get(k)[_id.s] = n;
  });
  return map;
}
async function attendance(ctx) {
  const out = new Map();
  (await attendanceCounts(ctx)).forEach((c, k) => {
    const present = (c.present || 0) + (c.late || 0) + 0.5 * (c.half_day || 0);
    const total = (c.present || 0) + (c.late || 0) + (c.half_day || 0) + (c.absent || 0);
    if (total > 0) out.set(k, (present / total) * 100);
  });
  return out;
}
async function punctuality(ctx) {
  const out = new Map();
  (await attendanceCounts(ctx)).forEach((c, k) => {
    const total = (c.present || 0) + (c.late || 0) + (c.half_day || 0);
    if (total > 0) out.set(k, (((c.present || 0) + (c.half_day || 0)) / total) * 100);
  });
  return out;
}

async function peerFeedback(ctx) {
  const cycles = await FeedbackCycle.find({
    startDate: { $lte: new Date(`${ctx.endStr}T23:59:59.999Z`) },
    endDate:   { $gte: new Date(`${ctx.startStr}T00:00:00.000Z`) },
  }).select('_id').lean();
  if (!cycles.length) return new Map();
  const rows = await FeedbackSubmission.aggregate([
    { $match: { revieweeId: { $in: ctx.ids }, cycleId: { $in: cycles.map((c) => c._id) },
                reviewerType: 'peer', isSubmitted: true } },
    { $group: { _id: '$revieweeId', avg: { $avg: '$overallScore' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.avg]));
}

async function innovationScore(ctx) {
  const rows = await EmployeeAward.aggregate([
    { $match: { employee_id: { $in: ctx.ids }, award_type: 'innovation', status: 'announced',
                announced_at: { $gte: new Date(`${ctx.startStr}T00:00:00.000Z`),
                                $lte: new Date(`${ctx.endStr}T23:59:59.999Z`) } } },
    { $group: { _id: '$employee_id', n: { $sum: 1 } } },
  ]);
  const out = new Map(ctx.ids.map((i) => [String(i), 0]));   // 0 is real data here
  rows.forEach((r) => out.set(String(r._id), r.n));
  return out;
}

async function dailyIncentiveCount(ctx) {
  const rx = new RegExp(DAILY_INCENTIVE_KEYWORDS.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');
  const rows = await DailyLog.aggregate([
    { $match: { employee_id: { $in: ctx.ids }, isDeleted: { $ne: true }, kpi_name: rx,
                log_date: { $gte: ctx.startStr, $lte: ctx.endStr } } },
    { $group: { _id: '$employee_id', total: { $sum: '$value' } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.total]));
}

const RESOLVERS = {
  kpi_achievement: kpiAchievement,
  improvement,
  revenue: kpiMapped('revenue'),
  lead_conversion: kpiMapped('lead_conversion'),
  collection: kpiMapped('collection'),
  follow_up: kpiMapped('follow_up'),
  attendance,
  punctuality,
  peer_feedback: peerFeedback,
  innovation_score: innovationScore,
  daily_incentive_count: dailyIncentiveCount,
  // team_kpi is derived in the evaluator (department average of kpi_achievement)
};

module.exports = { RESOLVERS, isAbsolute, periodsBetween, previousPeriods };