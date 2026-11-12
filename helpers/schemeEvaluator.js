// helpers/schemeEvaluator.js  evaluates a qualifying-days scheme into AwardResult rows
const AwardResult = require('../models/AwardResult');
const { computeSchemeProgress } = require('./schemeProgress');

async function evaluateScheme(award) {
  const prog = await computeSchemeProgress(award);
  const need = prog.rule.days_required;
  const metricKey = award.qualifying_rule?.metric_key || 'daily_incentive_count';

  const existing = await AwardResult.find({ award_id: award._id }).lean();
  const oldBy = new Map(existing.map((r) => [r.entity_key, r]));

  // rank the people who qualified: more qualifying days, then more total incentives
  const qualified = prog.rows.filter((r) => r.qualified);   // already sorted that way
  qualified.forEach((r, i) => {
    const prev = qualified[i - 1];
    const same = prev && prev.qualifying_days === r.qualifying_days && prev.total === r.total;
    r.rank = same ? prev.rank : i + 1;
    if (same) { r.tied = true; prev.tied = true; }
  });

  const now = new Date();
  const ops = prog.rows.map((r) => {
    const ov = oldBy.get(r.employee_id)?.override;
    const calcRank = r.qualified ? r.rank : null;
    const final_rank = ov?.disqualified ? null : (ov?.final_rank ?? calcRank);
    return {
      updateOne: {
        filter: { award_id: award._id, entity_key: r.employee_id },
        update: {
          $set: {
            entity_type: 'employee', employee_id: r.employee_id, department: r.department,
            entity_name: r.name, employee_code: r.code,
            metric_values: [{ metric_key: metricKey, raw: r.qualifying_days,
              score: need ? Math.min(100, (r.qualifying_days / need) * 100) : 0,
              weight: 100, source: 'auto', missing: false }],
            weighted_score: r.qualifying_days, missing_metrics: [],
            eligibility: { passed: r.qualified,
              reasons: r.qualified ? [] : [`Qualified on ${r.qualifying_days} of ${need} days`] },
            facts: { kpi_percent: null, attendance_percent: null, revenue: null, service_months: null },
            scheme: { source: r.source, total: r.total, qualifying_days: r.qualifying_days, days_required: need },
            rank: calcRank, tied: !!r.tied, final_rank, evaluated_at: now,
          },
          $setOnInsert: { manual_scores: {}, status: 'calculated' },
        },
        upsert: true,
      },
    };
  });
  if (ops.length) await AwardResult.bulkWrite(ops);
  await AwardResult.deleteMany({
    award_id: award._id, status: { $ne: 'finalized' },
    entity_key: { $nin: prog.rows.map((r) => r.employee_id) }, 'override.final_rank': null,
  });
  return { evaluated: prog.rows.length, eligible: qualified.length, periods: [] };
}

module.exports = { evaluateScheme };