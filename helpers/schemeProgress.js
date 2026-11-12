// helpers/schemeProgress.js
// Live daily progress for a qualifying-days scheme. One source per employee (never summed):
//   loan_incentive : LoanCustomer, staffId, incentive.eligibility = Paid, by incentive.paidAt
//   sale_entries   : IncentiveResult.sale_entries, status approved/paid, by entry.date
//   daily_log      : DailyLog value for the KPI names chosen in the scheme, by log_date
const Employee = require('../models/Employee');
const DailyLog = require('../models/DailyLog');
const IncentiveResult = require('../models/IncentiveResult');
const IncentiveAssignment = require('../models/IncentiveAssignment');
const LoanCustomer = require('../models/LoanCustomer');
const SchemeSource = require('../models/SchemeSource');
const { toDateStr } = require('./awardDefinitionValidator');
const { participantFilter } = require('./awardParticipants');

const SOURCES = ['loan_incentive', 'sale_entries', 'daily_log'];
const FORCED = { kpi: 'daily_log', incentive: 'sale_entries', loan: 'loan_incentive' };   // source decided by the scheme's basis
const LOOKBACK_DAYS = 90;     // how far back we look to decide "this person is on the loan team"

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const istStart = (s) => new Date(`${s}T00:00:00.000+05:30`);
const istEnd = (s) => new Date(`${s}T23:59:59.999+05:30`);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function eachDay(startStr, endStr) {
  const out = [];
  const d = new Date(`${startStr}T00:00:00.000Z`);
  for (let i = 0; i < 400; i++) {
    const s = d.toISOString().slice(0, 10);
    if (s > endStr) break;
    out.push(s);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

const addCount = (map, emp, day, n) => {
  const k = String(emp);
  if (!map.has(k)) map.set(k, new Map());
  const m = map.get(k);
  m.set(day, (m.get(day) || 0) + n);
};

async function computeSchemeProgress(award, opts = {}) {
  const startStr = toDateStr(award.start_date);
  const endStr = toDateStr(award.end_date);
  const today = todayIST();
  const endEff = endStr < today ? endStr : today;
  const allDays = eachDay(startStr, endStr);
  const rule = award.qualifying_rule || {};
  const forced = FORCED[award.basis] || null;
  const minDaily = Number(rule.min_daily_value) || 0;
  const need = Number(rule.days_required) || 0;

  // participants
  // const filter = { status: { $in: ['approved', 'active'] } };
  // if (award.departments?.length) filter.department = { $in: award.departments };
  //   if (opts.employeeId) filter._id = opts.employeeId; 
  const filter = participantFilter(award);
  if (opts.employeeId) filter.$and = [{ _id: opts.employeeId }];   // employee-side screen: just that one person        
  const employees = await Employee.find(filter).select('_id name employeeId department').lean();
  const ids = employees.map((e) => e._id);

  // ── auto-detect source: Loan -> Incentive result -> Daily Log ──
  const from = new Date(istStart(startStr).getTime() - LOOKBACK_DAYS * 86400000);
  const to = istEnd(endStr);
  const monthKeys = [...new Set(allDays.map((d) => d.slice(0, 7)))];
  const [loanIds, resultIds, assignIds, overrides] = await Promise.all([
    LoanCustomer.distinct('staffId', {
      staffId: { $in: ids },
      $or: [{ createdAt: { $gte: from, $lte: to } }, { 'incentive.paidAt': { $gte: from, $lte: to } }]
    }),
    IncentiveResult.distinct('employee_id', { employee_id: { $in: ids }, 'sale_entries.date': { $gte: from, $lte: to } }),
    IncentiveAssignment.distinct('employee_id', { employee_id: { $in: ids }, period: { $in: monthKeys } }),
    SchemeSource.find({ award_id: award._id }).lean(),
  ]);
  const loanSet = new Set(loanIds.map(String));
  const saleSet = new Set([...resultIds, ...assignIds].map(String));
  const overrideBy = new Map(overrides.map((o) => [String(o.employee_id), o.source]));

  const autoOf = (id) => (loanSet.has(id) ? 'loan_incentive' : saleSet.has(id) ? 'sale_entries' : 'daily_log');
  const sourceOf = new Map(employees.map((e) => {
    const id = String(e._id);
    return [id, forced || overrideBy.get(id) || autoOf(id)];     // a chosen basis wins over auto-detect
  }));
  const idsFor = (src) => employees.filter((e) => sourceOf.get(String(e._id)) === src).map((e) => e._id);

  // ── daily counts per source ──
  const counts = new Map();   // empId -> Map(day -> count)

  const logIds = idsFor('daily_log');
  const names = (rule.daily_kpi_names || []).map((s) => String(s).trim()).filter(Boolean);
  if (logIds.length && names.length) {
    const rows = await DailyLog.aggregate([
      {
        $match: {
          employee_id: { $in: logIds }, isDeleted: { $ne: true },
          log_date: { $gte: startStr, $lte: endEff },
          $or: names.map((n) => ({ kpi_name: { $regex: `^${esc(n)}$`, $options: 'i' } }))
        }
      },
      { $group: { _id: { e: '$employee_id', d: '$log_date' }, n: { $sum: '$value' } } },
    ]);
    rows.forEach((r) => addCount(counts, r._id.e, r._id.d, r.n));
  }

  const saleIds = idsFor('sale_entries');
  if (saleIds.length) {
    const rows = await IncentiveResult.aggregate([
      { $match: { employee_id: { $in: saleIds } } },
      { $unwind: '$sale_entries' },
      {
        $match: {
          'sale_entries.status': { $in: ['approved', 'paid'] },
          'sale_entries.date': { $gte: istStart(startStr), $lte: to }
        }
      },
      {
        $group: {
          _id: {
            e: '$employee_id',
            d: { $dateToString: { format: '%Y-%m-%d', date: '$sale_entries.date', timezone: 'Asia/Kolkata' } }
          },
          n: { $sum: 1 }
        }
      },
    ]);
    rows.forEach((r) => addCount(counts, r._id.e, r._id.d, r.n));
  }

  const loanIdsUse = idsFor('loan_incentive');
  if (loanIdsUse.length) {
    const byCreated = award.loan_count_on === 'created';
    const dateField = byCreated ? '$createdAt' : '$incentive.paidAt';
    const match = byCreated
      ? { staffId: { $in: loanIdsUse }, createdAt: { $gte: istStart(startStr), $lte: to } }
      : { staffId: { $in: loanIdsUse }, 'incentive.eligibility': 'Paid', 'incentive.paidAt': { $gte: istStart(startStr), $lte: to } };
    const rows = await LoanCustomer.aggregate([
      { $match: match },
      { $group: { _id: { e: '$staffId', d: { $dateToString: { format: '%Y-%m-%d', date: dateField, timezone: 'Asia/Kolkata' } } }, n: { $sum: 1 } } },
    ]);
    rows.forEach((r) => addCount(counts, r._id.e, r._id.d, r.n));
  }

  // ── per employee result ──
  const rows = employees.map((e) => {
    const id = String(e._id);
    const dayMap = counts.get(id) || new Map();
    const days = {};
    let qd = 0, total = 0;
    dayMap.forEach((n, d) => {
      days[d] = n; total += n;
      if (n > 0 && n >= minDaily) qd += 1;
    });
    const remaining = allDays.filter((d) => d > today || (d === today && !(days[d] > 0 && days[d] >= minDaily))).length;
    return {
      employee_id: id, name: e.name || '', code: e.employeeId || '', department: e.department || '',
      source: sourceOf.get(id), auto_source: forced || autoOf(id), overridden: !forced && overrideBy.has(id),
      days, qualifying_days: qd, total,
      qualified: need > 0 && qd >= need,
      remaining_days: remaining,
      can_still_qualify: need > 0 && qd + remaining >= need,
      today_count: days[today] || 0,
    };
  }).sort((a, b) => b.qualifying_days - a.qualifying_days || b.total - a.total || a.name.localeCompare(b.name));

  return {
    basis: award.basis || '', forced_source: forced,
    period: { start: startStr, end: endStr, today, days: allDays },
    rule: { min_daily_value: minDaily, days_required: need, daily_kpi_names: names },
    summary: {
      participants: rows.length,
      qualified: rows.filter((r) => r.qualified).length,
      on_track: rows.filter((r) => !r.qualified && r.can_still_qualify).length,
      out: rows.filter((r) => !r.qualified && !r.can_still_qualify).length,
    },
    rows,
  };
}

module.exports = { computeSchemeProgress, SOURCES };