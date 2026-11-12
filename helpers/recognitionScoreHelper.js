// helpers/recognitionScoreHelper.js
// Recognition score for the appraisal =
//   old Awards Hub points (spot / monthly star / innovation, points from RecognitionConfig)
// + points of published award-programme awards that are marked "counts in appraisal"
// then limited by the cap in RecognitionConfig (0 = no cap).
const EmployeeAward = require('../models/EmployeeAward');
const Employee = require('../models/Employee');
const AwardDefinition = require('../models/AwardDefinition');
const AwardResult = require('../models/AwardResult');
const AwardWorkflow = require('../models/AwardWorkflow');
const { getRecognitionConfig } = require('./recognitionConfig');
const { winnersOf } = require('./awardWinners');

// Defaults only. The live values come from RecognitionConfig (kept so old imports do not break).
const POINTS = { spot: 10, monthly_star: 30, innovation: 50 };

async function computeRecognitionScore(employeeId, fromDate, toDate) {
  const cfg = await getRecognitionConfig();
  const pts = { ...POINTS, ...(cfg.legacy_points || {}) };

  const range = {};
  if (fromDate) range.$gte = new Date(fromDate);
  if (toDate) range.$lte = new Date(toDate);
  const hasRange = Object.keys(range).length > 0;

  // ── 1. Awards Hub (spot / monthly star / innovation) ──
  const match = { employee_id: employeeId, status: 'announced' };
  if (hasRange) match.announced_at = range;
  const awards = await EmployeeAward.find(match).select('award_type category cash_amount announced_at reason');

  const breakdown = {
    spot:         { count: 0, points: 0 },
    monthly_star: { count: 0, points: 0 },
    innovation:   { count: 0, points: 0 },
    awards_program: { count: 0, points: 0 },
  };
  awards.forEach((a) => {
    if (breakdown[a.award_type] && a.award_type !== 'awards_program') {
      breakdown[a.award_type].count += 1;
      breakdown[a.award_type].points += pts[a.award_type] || 0;
    }
  });

  // ── 2. Award programme (published, counts_in_appraisal) ──
  const skipped = [];
  const wfMatch = { status: 'published' };
  if (hasRange) wfMatch.published_at = range;
  const wfs = await AwardWorkflow.find(wfMatch).select('award_id').lean();
  const defs = wfs.length
    ? await AwardDefinition.find({ _id: { $in: wfs.map((w) => w.award_id) }, counts_in_appraisal: true, recognition_points: { $gt: 0 } }).lean()
    : [];

  const usable = [];
  defs.forEach((a) => {
    // innovation is already counted through the Awards Hub points, so never count it twice
    if ((a.metrics || []).some((m) => m.metric_key === 'innovation_score')) {
      skipped.push({ award: a.name, reason: 'Innovation is already counted in the Recognition score' });
    } else usable.push(a);
  });

  if (usable.length) {
    const emp = await Employee.findById(employeeId).select('department').lean();
    const rows = await AwardResult.find({
      award_id: { $in: usable.map((a) => a._id) }, status: 'finalized', final_rank: { $ne: null },
      $or: [{ employee_id: employeeId }, { entity_type: 'department', department: emp?.department || '__none__' }],
    }).lean();
    rows.forEach((r) => {
      const a = usable.find((x) => String(x._id) === String(r.award_id));
      if (a && winnersOf(a, [r]).length) {
        breakdown.awards_program.count += 1;
        breakdown.awards_program.points += a.recognition_points;
      }
    });
  }

  // ── 3. Total and cap ──
  const raw_total = breakdown.spot.points + breakdown.monthly_star.points + breakdown.innovation.points + breakdown.awards_program.points;
  const cap = cfg.cap_points || 0;
  const total = cap > 0 ? Math.min(raw_total, cap) : raw_total;

  return { breakdown, total, raw_total, cap, capped: cap > 0 && raw_total > cap, skipped, awards };
}

module.exports = { computeRecognitionScore, POINTS };