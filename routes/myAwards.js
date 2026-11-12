// routes/myAwards.js  Phase 5: what an employee sees. Only their own data.
//
// /published  awards I won (published only)
// /schemes    my qualifying-days schemes, each with a STAGE so the employee always knows where it stands:
//               running    period is on
//               ended      period is over, HR has not evaluated yet
//               evaluating results are being calculated / finalized
//               in_review  waiting for approval (HR -> Committee -> Management)
//               approved   approved, winners will be announced soon
//               published  announced, and I was NOT a winner  (winners go to /published, never here)
// The employee never sees other people's ranks or any approval remarks, only the stage and step names.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const AwardDefinition = require('../models/AwardDefinition');
const AwardResult = require('../models/AwardResult');
const AwardWorkflow = require('../models/AwardWorkflow');
const RewardIssue = require('../models/RewardIssue');
const Employee = require('../models/Employee');
const { winnersOf } = require('../helpers/awardWinners');
const { computeSchemeProgress } = require('../helpers/schemeProgress');
const { toDateStr } = require('../helpers/awardDefinitionValidator');
const auth = require('../middleware/auth');

router.use(auth);

const DAY = 86400000;
const LOOKBACK_ENDED_DAYS = 120;      // ended schemes older than this are not loaded at all
const PAST_VISIBLE_DAYS = 60;         // a "not selected" result stays visible this long after it is announced

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const fail = (req, res, err) => {
  console.error(`[my-awards] ${req.method} ${req.originalUrl} failed:`, err);
  return res.status(500).json({ success: false, message: err.message });
};
async function me(req, res) {
  if (req.user?.role === 'hr' || req.user?.role === 'admin' || !mongoose.isValidObjectId(req.user?.id)) {
    res.status(403).json({ success: false, message: 'EMPLOYEE_ONLY' }); return null;
  }
  const emp = await Employee.findById(req.user.id).select('department').lean();
  if (!emp) { res.status(404).json({ success: false, message: 'Employee not found' }); return null; }
  return { id: req.user.id, department: emp.department || '' };
}
const mineFilter = (m) => ({ $or: [{ employee_id: m.id }, { entity_type: 'department', department: m.department }] });

// How I did in an award I won. Only my own numbers. A failure here must never hide the award itself.
async function detailsOf(a, r, m) {
  try {
    if (a.rule_type === 'qualifying_days' && r.entity_type !== 'department') {
      const prog = await computeSchemeProgress(a, { employeeId: m.id });
      const row = prog.rows[0];
      if (!row) return null;
      return {
        kind: 'scheme',
        scheme: {
          period: prog.period,
          rule: { min_daily_value: prog.rule.min_daily_value, days_required: prog.rule.days_required },
          mine: { days: row.days, qualifying_days: row.qualifying_days, total: row.total, qualified: row.qualified },
        },
      };
    }
    return {
      kind: 'score',
      weighted_score: r.weighted_score,
      metrics: (r.metric_values || []).map((v) => ({ metric_key: v.metric_key, raw: v.raw, score: v.score, weight: v.weight })),
    };
  } catch (e) {
    console.error('[my-awards] details failed:', e.message);
    return null;
  }
}

// ── GET /published ─ awards I won (published only) ─────────────────────────
router.get('/published', async (req, res) => {
  try {
    const m = await me(req, res); if (!m) return;
    const mine = mineFilter(m);
    const results = await AwardResult.find({ ...mine, status: 'finalized', final_rank: { $ne: null } }).lean();
    const awardIds = [...new Set(results.map((r) => String(r.award_id)))];

    const [wfs, awards, issues] = await Promise.all([
      AwardWorkflow.find({ award_id: { $in: awardIds }, status: 'published' }).lean(),
      AwardDefinition.find({ _id: { $in: awardIds } }).lean(),
      RewardIssue.find({ award_id: { $in: awardIds }, status: { $ne: 'cancelled' }, ...mine }).lean(),
    ]);
    const wfBy = new Map(wfs.map((w) => [String(w.award_id), w]));
    const awardBy = new Map(awards.map((a) => [String(a._id), a]));

    const data = [];
    for (const r of results) {
      const k = String(r.award_id);
      const a = awardBy.get(k), wf = wfBy.get(k);
      if (!a || !wf || !winnersOf(a, [r]).length) continue;
      data.push({
        award_id: a._id, name: a.name, category: a.category, description: a.description,
        start_date: a.start_date, end_date: a.end_date, published_at: wf.published_at,
        rank: r.final_rank, team: r.entity_type === 'department',
        rewards: issues.filter((i) => String(i.award_id) === k).map((i) => ({
          reward_type: i.reward_type, title: i.title, status: i.status, issued_at: i.issued_at || null,
          cash_amount: i.cash_amount, points: i.points, item_name: i.item_name,
        })),
        details: await detailsOf(a, r, m),
      });
    }
    data.sort((x, y) => new Date(y.published_at) - new Date(x.published_at));

    res.json({ success: true, data });
  } catch (err) { fail(req, res, err); }
});

// Where is this scheme right now?
function stageOf(a, wf, today, hasResults, hasFinal) {
  if (wf) {
    if (wf.status === 'published') return 'published';
    if (wf.status === 'approved') return 'approved';
    return 'in_review';                                     // in_review, or sent back for another look
  }
  if (hasFinal) return 'evaluating';                        // finalized, not yet submitted for approval
  const ended = a.status === 'closed' || toDateStr(a.end_date) < today;
  if (!ended) return 'running';
  return hasResults ? 'evaluating' : 'ended';
}

// ── GET /schemes ─ my schemes with their stage, my own progress only ───────
router.get('/schemes', async (req, res) => {
  try {
    const m = await me(req, res); if (!m) return;
    const today = todayIST();
    const mine = mineFilter(m);

    const awards = await AwardDefinition.find({
      rule_type: 'qualifying_days',
      status: { $in: ['active', 'closed'] },
      end_date: { $gte: new Date(Date.now() - LOOKBACK_ENDED_DAYS * DAY) },
    }).lean();
    if (!awards.length) return res.json({ success: true, data: [] });

    const ids = awards.map((a) => a._id);
    const [wfs, anyRes, finRes, myRes] = await Promise.all([
      AwardWorkflow.find({ award_id: { $in: ids } }).lean(),
      AwardResult.distinct('award_id', { award_id: { $in: ids } }),
      AwardResult.distinct('award_id', { award_id: { $in: ids }, status: 'finalized' }),
      AwardResult.find({ award_id: { $in: ids }, ...mine }).lean(),
    ]);
    const wfBy = new Map(wfs.map((w) => [String(w.award_id), w]));
    const hasRes = new Set(anyRes.map(String));
    const hasFin = new Set(finRes.map(String));
    const myResBy = new Map(myRes.map((r) => [String(r.award_id), r]));

    const out = [];
    for (const a of awards) {
      const k = String(a._id);
      const wf = wfBy.get(k);
      const stage = stageOf(a, wf, today, hasRes.has(k), hasFin.has(k));

      let outcome = null;
      if (stage === 'published') {
        const row = myResBy.get(k);
        if (row && winnersOf(a, [row]).length) continue;     // I won: it lives under "Awards I won", never here
        if (!wf.published_at || Date.now() - new Date(wf.published_at).getTime() > PAST_VISIBLE_DAYS * DAY) continue;
        outcome = 'not_selected';
      }

      const prog = await computeSchemeProgress(a, { employeeId: m.id });
      const row = prog.rows[0];
      if (!row) continue;                                    // not a participant of this scheme

      // approval steps: names and done/pending only. Remarks and people are never sent to employees.
      const steps = (wf?.steps || []).map((s) => ({ step: s.step, status: s.status === 'approved' ? 'approved' : 'pending' }));
      const current = steps.find((s) => s.status === 'pending')?.step || null;

      out.push({
        award_id: a._id, name: a.name, description: a.description,
        stage, outcome, steps, current_step: current, published_at: wf?.published_at || null,
        period: prog.period, rule: { min_daily_value: prog.rule.min_daily_value, days_required: prog.rule.days_required },
        rewards: (a.rewards || []).map((r) => ({ type: r.type, title: r.title, cash_amount: r.cash_amount })),
        mine: {
          days: row.days, qualifying_days: row.qualifying_days, total: row.total, qualified: row.qualified,
          remaining_days: row.remaining_days, can_still_qualify: row.can_still_qualify, today_count: row.today_count,
        },
      });
    }

    const order = { running: 0, ended: 1, evaluating: 1, in_review: 1, approved: 1, published: 2 };
    out.sort((x, y) => (order[x.stage] - order[y.stage]) || String(y.period.end).localeCompare(String(x.period.end)));
    res.json({ success: true, data: out });
  } catch (err) { fail(req, res, err); }
});

module.exports = router;