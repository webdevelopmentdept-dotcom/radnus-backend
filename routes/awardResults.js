// routes/awardResults.js  (Phase 2: evaluation engine)
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const AwardDefinition = require('../models/AwardDefinition');
const AwardResult = require('../models/AwardResult');
const C = require('../constants/awardMetrics');
const { evaluateAward } = require('../helpers/awardEvaluator');
const auth = require('../middleware/auth');
const hrOnly = require('../middleware/hrOnly');
const SchemeSource = require('../models/SchemeSource');
const { computeSchemeProgress, SOURCES } = require('../helpers/schemeProgress');

router.use(auth, hrOnly);   // auditWrites logs every POST/PUT here automatically

const actorName = (req) => req.actor?.name || req.user?.name || '';
const METRIC_SOURCE = Object.fromEntries(C.METRICS.map((m) => [m.key, m.source]));
const send = (res, status, message, extra = {}) => res.status(status).json({ success: false, message, ...extra });
const fail = (req, res, err) => {
  console.error(`[award-results] ${req.method} ${req.originalUrl} failed:`, err);
  return send(res, err.status || 500, err.message);
};

async function loadAward(req, res) {
  if (!mongoose.isValidObjectId(req.params.awardId)) { send(res, 404, 'Award not found'); return null; }
  const award = await AwardDefinition.findById(req.params.awardId);
  if (!award) { send(res, 404, 'Award not found'); return null; }
  if (award.status === 'draft') { send(res, 409, 'Launch the award first. Draft awards cannot be evaluated.'); return null; }
  return award;
}
const isFinalized = (awardId) => AwardResult.exists({ award_id: awardId, status: 'finalized' });
const lockedMsg = 'Results are finalized, so they cannot be changed.';

// ── POST /:awardId/evaluate ─ calculate or re-calculate ────────────────────
router.post('/:awardId/evaluate', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    if (await isFinalized(award._id)) return send(res, 409, lockedMsg);
    const summary = await evaluateAward(award);
    res.json({ success: true, data: summary });
  } catch (err) { fail(req, res, err); }
});

// ── GET /:awardId ─ ranked list ─────────────────────────────────────────────
router.get('/:awardId', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    const rows = await AwardResult.find({ award_id: award._id }).lean();

    const eligible = rows.filter((r) => r.eligibility?.passed || r.override?.final_rank != null)
      .filter((r) => !r.override?.disqualified)
      .sort((a, b) => (a.final_rank ?? 9999) - (b.final_rank ?? 9999) || b.weighted_score - a.weighted_score);
    const ids = new Set(eligible.map((r) => String(r._id)));
    const others = rows.filter((r) => !ids.has(String(r._id)))
      .sort((a, b) => (a.entity_name || '').localeCompare(b.entity_name || ''));

    const manualMetrics = (award.metrics || []).filter((m) => METRIC_SOURCE[m.metric_key] === 'manual').map((m) => m.metric_key);
    res.json({
      success: true,
      data: {
        award: { _id: award._id, name: award.name, status: award.status, rule_type: award.rule_type,
                 participation: award.participation, winners: award.winners, rewards: award.rewards },
        locked: rows.some((r) => r.status === 'finalized'),
        evaluated: rows.length > 0,
        manual_metrics: manualMetrics,
        ranked: eligible,
        not_ranked: others,
      },
    });
  } catch (err) { fail(req, res, err); }
});

// ── PUT /:awardId/manual-scores ─ committee enters customer_feedback / committee_score ──
// body: { scores: [{ entity_key, metric_key, value }] }   value is 0-100
router.put('/:awardId/manual-scores', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    if (await isFinalized(award._id)) return send(res, 409, lockedMsg);
    const scores = Array.isArray(req.body?.scores) ? req.body.scores : [];
    if (!scores.length) return send(res, 400, 'No scores sent');

    const allowed = new Set((award.metrics || []).map((m) => m.metric_key));
    for (const s of scores) {
      if (METRIC_SOURCE[s.metric_key] !== 'manual' || !allowed.has(s.metric_key))
        return send(res, 400, `"${s.metric_key}" is not a manual metric of this award`);
      const v = Number(s.value);
      if (s.value === '' || s.value === null || !Number.isFinite(v) || v < 0 || v > 100)
        return send(res, 400, 'Manual scores must be between 0 and 100');
    }
    await AwardResult.bulkWrite(scores.map((s) => ({
      updateOne: {
        filter: { award_id: award._id, entity_key: String(s.entity_key) },
        update: { $set: { [`manual_scores.${s.metric_key}`]: Number(s.value) } },
      },
    })));
    const summary = await evaluateAward(award);     // recompute totals and ranks
    res.json({ success: true, data: summary });
  } catch (err) { fail(req, res, err); }
});

// ── POST /:awardId/override ─ committee override, reason is mandatory ───────
// body: { entity_key, action: 'set_rank'|'disqualify'|'clear', rank?, reason }
router.post('/:awardId/override', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    if (await isFinalized(award._id)) return send(res, 409, lockedMsg);

    const { entity_key, action } = req.body || {};
    const reason = String(req.body?.reason || '').trim();
    const row = await AwardResult.findOne({ award_id: award._id, entity_key: String(entity_key) });
    if (!row) return send(res, 404, 'Participant not found. Evaluate the award first.');

    if (action === 'clear') {
      row.override = { final_rank: null, disqualified: false, reason: '', by: '', at: null };
      row.final_rank = row.eligibility.passed ? row.rank : null;
    } else {
      if (reason.length < 10) return send(res, 400, 'Please give a clear reason (at least 10 characters) for the override');
      if (action === 'set_rank') {
        const rank = Math.floor(Number(req.body.rank));
        if (!Number.isFinite(rank) || rank < 1) return send(res, 400, 'Rank must be 1 or more');
        row.override = { final_rank: rank, disqualified: false, reason, by: actorName(req), at: new Date() };
        row.final_rank = rank;
      } else if (action === 'disqualify') {
        row.override = { final_rank: null, disqualified: true, reason, by: actorName(req), at: new Date() };
        row.final_rank = null;
      } else {
        return send(res, 400, 'action must be set_rank, disqualify or clear');
      }
    }
    await row.save();
    res.json({ success: true, data: row });
  } catch (err) { fail(req, res, err); }
});

// ── POST /:awardId/finalize ─ freeze the ranking ────────────────────────────
router.post('/:awardId/finalize', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    const rows = await AwardResult.find({ award_id: award._id });
    if (!rows.length) return send(res, 400, 'Evaluate the award first');
    if (rows.some((r) => r.status === 'finalized')) return send(res, 409, lockedMsg);

    const pending = rows.filter((r) => r.eligibility.passed && !r.override?.disqualified && r.missing_metrics.some((k) => METRIC_SOURCE[k] === 'manual'));
    if (pending.length) return send(res, 409, `Manual scores are still pending for ${pending.length} participant(s)`);

        const maxRewardRank = Math.max(0, ...(award.rewards || []).map((r) => r.rank_to || 0));
    const limit = award.winners?.mode === 'all_qualifying' ? maxRewardRank : (award.winners?.count || 0); 
    const inRange = rows.filter((r) => r.final_rank != null && r.final_rank <= limit);
    const dup = inRange.length !== new Set(inRange.map((r) => r.final_rank)).size;
    if (dup) return send(res, 409, 'There is an unresolved tie in the winning positions. Set the rank with an override and a reason.');

    await AwardResult.updateMany({ award_id: award._id },
      { $set: { status: 'finalized', finalized_at: new Date(), finalized_by: actorName(req) } });
    res.json({ success: true, message: 'Results finalized' });
  } catch (err) { fail(req, res, err); }
});


// ── GET /:awardId/scheme-progress ─ live daily progress ─────────────────────
router.get('/:awardId/scheme-progress', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    if (award.rule_type !== 'qualifying_days') return send(res, 400, 'This award is not a qualifying-days scheme');
    res.json({ success: true, data: await computeSchemeProgress(award) });
  } catch (err) { fail(req, res, err); }
});

// ── PUT /:awardId/scheme-source ─ HR picks the data source for one employee ──
// body: { employee_id, source: 'loan_incentive'|'sale_entries'|'daily_log'|'auto' }
router.put('/:awardId/scheme-source', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    if (award.rule_type !== 'qualifying_days') return send(res, 400, 'This award is not a qualifying-days scheme');
    if (await isFinalized(award._id)) return send(res, 409, lockedMsg);
    const { employee_id, source } = req.body || {};
    if (!mongoose.isValidObjectId(employee_id)) return send(res, 400, 'Invalid employee');
    if (source === 'auto') {
      await SchemeSource.deleteOne({ award_id: award._id, employee_id });
    } else if (SOURCES.includes(source)) {
      await SchemeSource.updateOne({ award_id: award._id, employee_id },
        { $set: { source, set_by_name: actorName(req) } }, { upsert: true });
    } else return send(res, 400, 'Invalid source');
    res.json({ success: true });
  } catch (err) { fail(req, res, err); }
});

module.exports = router;