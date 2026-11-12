// helpers/awardEvaluator.js
const Employee = require('../models/Employee');
const EmploymentDetails = require('../models/EmploymentDetails');
const AwardResult = require('../models/AwardResult');
const C = require('../constants/awardMetrics');
const { RESOLVERS, isAbsolute, periodsBetween, previousPeriods } = require('./metricResolvers');
const { toDateStr } = require('./awardDefinitionValidator');
const { participantFilter } = require('./awardParticipants');

const METRIC_SOURCE = Object.fromEntries(C.METRICS.map((m) => [m.key, m.source]));
const clamp = (n, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round2 = (n) => Math.round(n * 100) / 100;
const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

// date_of_joining is a String in EmploymentDetails. Accept YYYY-MM-DD and DD/MM/YYYY.
function parseJoining(s) {
  if (!s) return null;
  const str = String(s).trim();
  let m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = str.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return new Date(Date.UTC(+m[3], +m[2] - 1, +m[1]));
  const d = new Date(str);
  return isNaN(d) ? null : d;
}
function monthsBetween(from, to) {
  let n = (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) n -= 1;
  return Math.max(0, n);
}

async function evaluateAward(award) {
    
  if (award.rule_type === 'qualifying_days') {
    return require('./schemeEvaluator').evaluateScheme(award);
  }
  const startStr = toDateStr(award.start_date);
  const endStr = toDateStr(award.end_date);
  const endEffStr = endStr < todayIST() ? endStr : todayIST();   // do not count future days

  // ── participants ──
  // const empFilter = { status: { $in: ['approved', 'active'] } };
  // if (award.departments?.length) empFilter.department = { $in: award.departments };

    const empFilter = participantFilter(award);
  const employees = await Employee.find(empFilter).select('_id name employeeId department').lean();
  const ids = employees.map((e) => e._id);

  const details = await EmploymentDetails.find({ employee_id: { $in: ids } })
    .select('employee_id employment.date_of_joining').lean();
  const joinByEmp = new Map(details.map((d) => [String(d.employee_id), parseJoining(d.employment?.date_of_joining)]));
  const deptByEmp = new Map(employees.map((e) => [String(e._id), e.department || '']));

  // ── entities (employees, or departments for team awards) ──
  let entities;
  if (award.participation === 'team') {
    const byDept = new Map();
    employees.forEach((e) => {
      const d = e.department || 'Unassigned';
      if (!byDept.has(d)) byDept.set(d, []);
      byDept.get(d).push(e);
    });
    entities = [...byDept].map(([d, members]) => ({
      key: `dept:${d}`, type: 'department', department: d, name: d, code: '',
      members: members.map((m) => String(m._id)), employee_id: null,
    }));
  } else {
    entities = employees.map((e) => ({
      key: String(e._id), type: 'employee', department: e.department || '', name: e.name || '',
      code: e.employeeId || '', members: [String(e._id)], employee_id: e._id,
    }));
  }

  // ── which metrics to read ──
  const metrics = award.metrics || [];
  const needed = new Set(metrics.map((m) => m.metric_key));
  const elig = award.eligibility || {};
  const ties = award.tie_breakers || [];
  if (elig.min_kpi_percent > 0 || ties.includes('higher_kpi') || needed.has('team_kpi')) needed.add('kpi_achievement');
  if (elig.min_attendance_percent > 0 || ties.includes('higher_attendance')) needed.add('attendance');
  if (ties.includes('higher_revenue')) needed.add('revenue');

  const ctx = {
    ids, startStr, endStr, endEffStr,
    periods: periodsBetween(startStr, endStr),
    prevPeriods: previousPeriods(startStr, endStr),
  };

  // rawByEmp[metric] = Map(empId -> raw)
  const rawByEmp = {};
  for (const key of needed) {
    if (key === 'team_kpi') continue;
    if (METRIC_SOURCE[key] === 'manual' || !RESOLVERS[key]) continue;
    rawByEmp[key] = await RESOLVERS[key](ctx);
  }
  if (needed.has('team_kpi')) {   // department average of each member's KPI achievement
    const kpi = rawByEmp.kpi_achievement || new Map();
    const sums = new Map();
    kpi.forEach((v, emp) => {
      const d = deptByEmp.get(emp);
      const s = sums.get(d) || { t: 0, n: 0 };
      s.t += v; s.n += 1; sums.set(d, s);
    });
    const out = new Map();
    employees.forEach((e) => {
      const s = sums.get(e.department || '');
      if (s) out.set(String(e._id), s.t / s.n);
    });
    rawByEmp.team_kpi = out;
  }

  // existing results: keep manual scores + overrides
  const existing = await AwardResult.find({ award_id: award._id }).lean();
  const existingByKey = new Map(existing.map((r) => [r.entity_key, r]));

  // raw value of one metric for one entity
  const entityRaw = (ent, key) => {
    if (METRIC_SOURCE[key] === 'manual') {
      const v = existingByKey.get(ent.key)?.manual_scores?.[key];
      return typeof v === 'number' ? v : null;
    }
    const map = rawByEmp[key];
    if (!map) return null;
    const vals = ent.members.map((m) => map.get(m)).filter((v) => typeof v === 'number');
    if (!vals.length) return null;
    const sum = vals.reduce((a, b) => a + b, 0);
    return isAbsolute(key) && ent.type === 'department' ? sum : sum / vals.length;
  };

  // best value per absolute metric (to scale against)
  const maxByKey = {};
  metrics.forEach((m) => {
    if (!isAbsolute(m.metric_key)) return;
    maxByKey[m.metric_key] = Math.max(0, ...entities.map((e) => entityRaw(e, m.metric_key) ?? 0));
  });

  const scoreOf = (m, raw) => {
    if (raw === null) return null;
    if (m.target > 0) return clamp((raw / m.target) * 100);                  // award-level target override
    if (isAbsolute(m.metric_key)) {
      const max = maxByKey[m.metric_key];
      return max > 0 ? clamp((raw / max) * 100) : 0;
    }
    return clamp(raw);                                                        // already a % / 0-100 value
  };

  // ── score + eligibility per entity ──
  const refDate = new Date(`${endStr}T00:00:00.000Z`);
  const rows = entities.map((ent) => {
    const metric_values = [];
    const missing = [];
    let weighted = 0;
    if (award.rule_type === 'weighted_score') {
      metrics.forEach((m) => {
        const raw = entityRaw(ent, m.metric_key);
        const score = scoreOf(m, raw);
        const isMissing = raw === null;
        if (isMissing) missing.push(m.metric_key);
        weighted += (score ?? 0) * (m.weight / 100);
        metric_values.push({
          metric_key: m.metric_key, raw, score, weight: m.weight,
          source: METRIC_SOURCE[m.metric_key] || 'auto', missing: isMissing,
        });
      });
    }

    const facts = {
      kpi_percent: entityRaw(ent, 'kpi_achievement'),
      attendance_percent: entityRaw(ent, 'attendance'),
      revenue: entityRaw(ent, 'revenue'),
      service_months: null,
    };
    if (ent.type === 'employee') {
      const j = joinByEmp.get(ent.key);
      if (j) facts.service_months = monthsBetween(j, refDate);
    }

    const reasons = [];
    if (elig.min_kpi_percent > 0) {
      if (facts.kpi_percent === null) reasons.push('No finalized KPI review for this period');
      else if (facts.kpi_percent < elig.min_kpi_percent)
        reasons.push(`KPI ${round2(facts.kpi_percent)}% is below the minimum ${elig.min_kpi_percent}%`);
    }
    if (elig.min_attendance_percent > 0) {
      if (facts.attendance_percent === null) reasons.push('No attendance records for this period');
      else if (facts.attendance_percent < elig.min_attendance_percent)
        reasons.push(`Attendance ${round2(facts.attendance_percent)}% is below the minimum ${elig.min_attendance_percent}%`);
    }
    if (elig.min_service_months > 0 && ent.type === 'employee') {
      if (facts.service_months === null) reasons.push('Date of joining is missing');
      else if (facts.service_months < elig.min_service_months)
        reasons.push(`Service ${facts.service_months} months is below the minimum ${elig.min_service_months}`);
    }

    return {
      ent, metric_values, missing, facts,
      weighted: round2(weighted),
      eligibility: { passed: reasons.length === 0, reasons },
    };
  });

  // ── ranking (eligible only) ──
  const cmpTie = (a, b) => {
    for (const t of ties) {
      let x = 0, y = 0;
      if (t === 'higher_kpi')        { x = a.facts.kpi_percent ?? -1;        y = b.facts.kpi_percent ?? -1; }
      else if (t === 'higher_attendance') { x = a.facts.attendance_percent ?? -1; y = b.facts.attendance_percent ?? -1; }
      else if (t === 'higher_revenue')    { x = a.facts.revenue ?? -1;           y = b.facts.revenue ?? -1; }
      else if (t === 'longer_service')    { x = a.facts.service_months ?? -1;    y = b.facts.service_months ?? -1; }
      else continue;                                  // committee_decision cannot be calculated
      if (x !== y) return y - x;
    }
    return 0;
  };

  const eligible = rows.filter((r) => r.eligibility.passed);
  if (award.rule_type === 'weighted_score') {
    eligible.sort((a, b) => (b.weighted - a.weighted) || cmpTie(a, b));
    eligible.forEach((r, i) => {
      const prev = eligible[i - 1];
      const same = prev && prev.weighted === r.weighted && cmpTie(prev, r) === 0;
      r.rank = same ? prev.rank : i + 1;
      if (same) { r.tied = true; prev.tied = true; }
    });
  }   // manual_selection: no calculated rank, the committee sets final ranks

  // ── save ──
  const now = new Date();
  const ops = rows.map((r) => {
    const old = existingByKey.get(r.ent.key);
    const ov = old?.override;
    const calcRank = r.eligibility.passed ? (r.rank ?? null) : null;
    const final_rank = ov?.disqualified ? null : (ov?.final_rank ?? calcRank);
    return {
      updateOne: {
        filter: { award_id: award._id, entity_key: r.ent.key },
        update: {
          $set: {
            entity_type: r.ent.type, employee_id: r.ent.employee_id, department: r.ent.department,
            entity_name: r.ent.name, employee_code: r.ent.code,
            metric_values: r.metric_values, weighted_score: r.weighted, missing_metrics: r.missing,
            eligibility: r.eligibility, facts: r.facts,
            rank: calcRank, tied: !!r.tied, final_rank, evaluated_at: now,
          },
          $setOnInsert: { manual_scores: {}, status: 'calculated' },
        },
        upsert: true,
      },
    };
  });
  if (ops.length) await AwardResult.bulkWrite(ops);
  // people who left the pool (and have no override) are removed
  await AwardResult.deleteMany({
    award_id: award._id, status: { $ne: 'finalized' },
    entity_key: { $nin: rows.map((r) => r.ent.key) }, 'override.final_rank': null,
  });

  return { evaluated: rows.length, eligible: eligible.length, periods: ctx.periods };
}

module.exports = { evaluateAward };