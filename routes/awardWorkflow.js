// routes/awardWorkflow.js  Phase 5: approvals, publish, analytics  (HR side)
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const AwardDefinition = require('../models/AwardDefinition');
const AwardResult = require('../models/AwardResult');
const AwardWorkflow = require('../models/AwardWorkflow');
const RewardIssue = require('../models/RewardIssue');
const Employee = require('../models/Employee');
const Notification = require('../models/Notification');
const C = require('../constants/awardMetrics');
const { winnersOf } = require('../helpers/awardWinners');
const auth = require('../middleware/auth');
const hrOnly = require('../middleware/hrOnly');

router.use(auth, hrOnly);

const who = (req) => req.user?.name || req.user?.email || '';
const isManagement = (u) => u?.role === 'admin' || u?.staffRole === 'md';
const roleLabel = (u) => (u?.role === 'admin' ? 'Admin' : u?.staffRole === 'md' ? 'MD' : 'HR');
const chainOf = (award) => {
  const set = new Set(award.approval_chain || []);
  return C.APPROVAL_STEPS.filter((s) => set.has(s));      // canonical order, only the steps this award uses
};
const send = (res, status, message) => res.status(status).json({ success: false, message });
const fail = (req, res, err) => {
  console.error(`[award-workflow] ${req.method} ${req.originalUrl} failed:`, err);
  return send(res, err.status || 500, err.message);
};
async function loadAward(req, res) {
  if (!mongoose.isValidObjectId(req.params.awardId)) { send(res, 404, 'Award not found'); return null; }
  const award = await AwardDefinition.findById(req.params.awardId).lean();
  if (!award) { send(res, 404, 'Award not found'); return null; }
  return award;
}
const finalizedRows = (awardId) => AwardResult.find({ award_id: awardId, status: 'finalized' }).lean();

// ── GET / ─ awards that have finalized results, with approval status ───────
router.get('/', async (req, res) => {
  try {
    const awardIds = await AwardResult.distinct('award_id', { status: 'finalized' });
    const [awards, wfs, results] = await Promise.all([
      AwardDefinition.find({ _id: { $in: awardIds } }).select('name category start_date end_date winners approval_chain').sort({ end_date: -1 }).lean(),
      AwardWorkflow.find({ award_id: { $in: awardIds } }).lean(),
      AwardResult.find({ award_id: { $in: awardIds }, status: 'finalized', final_rank: { $ne: null } })
        .select('award_id entity_name final_rank').sort({ final_rank: 1 }).lean(),
    ]);
    const wfBy = new Map(wfs.map((w) => [String(w.award_id), w]));
    const resBy = new Map();
    results.forEach((r) => {
      const k = String(r.award_id);
      if (!resBy.has(k)) resBy.set(k, []);
      resBy.get(k).push(r);
    });

    const data = awards.map((a) => {
      const wf = wfBy.get(String(a._id));
      const steps = wf ? wf.steps : chainOf(a).map((s) => ({ step: s, status: 'pending' }));
      const next = wf?.status === 'in_review' ? steps.find((s) => s.status === 'pending') : null;
      const winners = winnersOf(a, resBy.get(String(a._id)) || []);
      const returned = steps.find((s) => s.status === 'returned');
      return {
        award_id: a._id, name: a.name, category: a.category, start_date: a.start_date, end_date: a.end_date,
        stage: wf ? wf.status : 'not_submitted',
        steps, next_step: next?.step || null,
        can_act: !!next && (next.step !== 'management' || isManagement(req.user)),
        winners: winners.slice(0, 8).map((w) => ({ name: w.entity_name, rank: w.final_rank })),
        winners_total: winners.length,
        returned_remark: returned ? `${returned.by}: ${returned.remark}` : '',
        published_at: wf?.published_at || null,
      };
    });
    res.json({ success: true, data: { awards: data, me: { is_management: isManagement(req.user) } } });
  } catch (err) { fail(req, res, err); }
});

// ── POST /:awardId/submit ─ HR sends the finalized results for approval ────
router.post('/:awardId/submit', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    if (!(await AwardResult.exists({ award_id: award._id, status: 'finalized' })))
      return send(res, 409, 'Finalize the results first');
    if (await AwardWorkflow.exists({ award_id: award._id })) return send(res, 409, 'This award is already in the approval process');

    const now = new Date();
    const steps = chainOf(award).map((s) => ({ step: s, status: 'pending' }));
    const hr = steps.find((s) => s.step === 'hr');           // submitting counts as the HR step
    if (hr) Object.assign(hr, { status: 'approved', by: who(req), by_role: roleLabel(req.user), at: now, remark: String(req.body?.remark || '').slice(0, 300) });

    const wf = await AwardWorkflow.create({
      award_id: award._id, steps, submitted_by: who(req), submitted_at: now,
      status: steps.every((s) => s.status === 'approved') ? 'approved' : 'in_review',   // empty chain = auto approved
    });
    res.json({ success: true, data: wf });
  } catch (err) { fail(req, res, err); }
});

// ── POST /:awardId/step ─ committee / management decision ──────────────────
// body: { step, decision: 'approved'|'returned', remark, members: [names] }
router.post('/:awardId/step', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    const wf = await AwardWorkflow.findOne({ award_id: award._id });
    if (!wf || wf.status !== 'in_review') return send(res, 409, 'This award is not waiting for approval');

    const next = wf.steps.find((s) => s.status === 'pending');
    const { step, decision } = req.body || {};
    if (!next || next.step !== step) return send(res, 409, `The next step is "${next?.step}", not "${step}"`);
    if (step === 'management' && !isManagement(req.user)) return send(res, 403, 'Only the MD or admin can give the management approval');
    if (!['approved', 'returned'].includes(decision)) return send(res, 400, 'decision must be approved or returned');

    const remark = String(req.body?.remark || '').trim().slice(0, 500);
    if (decision === 'returned' && remark.length < 10) return send(res, 400, 'Please give a reason (at least 10 characters) when sending back');

    let members = [];
    if (step === 'committee' && decision === 'approved') {
      members = (Array.isArray(req.body?.members) ? req.body.members : [])
        .map((m) => String(m).trim().slice(0, 60)).filter(Boolean).slice(0, 12);
      if (!members.length) return send(res, 400, 'Add the names of the committee members who decided');
    }

    Object.assign(next, { status: decision, by: who(req), by_role: roleLabel(req.user), at: new Date(), remark, members });
    wf.status = decision === 'returned' ? 'returned' : (wf.steps.every((s) => s.status === 'approved') ? 'approved' : 'in_review');
    await wf.save();
    res.json({ success: true, data: wf });
  } catch (err) { fail(req, res, err); }
});

// ── POST /:awardId/publish ─ announce winners ──────────────────────────────
router.post('/:awardId/publish', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    const wf = await AwardWorkflow.findOneAndUpdate(
      { award_id: award._id, status: 'approved' },
      { $set: { status: 'published', published_at: new Date(), published_by: who(req) } }, { new: true });
    if (!wf) return send(res, 409, 'Only fully approved results can be published');

    const winners = winnersOf(award, await finalizedRows(award._id));
    const empIds = new Set();
    const depts = new Set();
    winners.forEach((w) => (w.entity_type === 'department' ? depts.add(w.department) : empIds.add(String(w.employee_id))));
    if (depts.size) {
      (await Employee.find({ department: { $in: [...depts] }, status: { $in: ['approved', 'active'] } }).select('_id').lean())
        .forEach((e) => empIds.add(String(e._id)));
    }
    let notified = 0;
    try {                                                    // a notification problem must not undo the publish
      const docs = [...empIds].map((id) => ({
        recipient_id: id, recipient_role: 'employee', type: 'award_published',
        title: `Congratulations! ${award.name}`,
        message: `You are among the winners of ${award.name}. Open My Awards to see your rewards.`,
        link: '/employee/my-awards',
      }));
      if (docs.length) await Notification.insertMany(docs);
      notified = docs.length;
    } catch (e) { console.error('[award-workflow] notify failed:', e.message); }

    res.json({ success: true, data: { winners: winners.length, notified } });
  } catch (err) { fail(req, res, err); }
});

// ── POST /:awardId/reopen ─ unlock results (not allowed after publish or once rewards are given) ──
router.post('/:awardId/reopen', async (req, res) => {
  try {
    const award = await loadAward(req, res); if (!award) return;
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 10) return send(res, 400, 'Please give a reason (at least 10 characters)');
    const wf = await AwardWorkflow.findOne({ award_id: award._id }).lean();
    if (wf?.status === 'published') return send(res, 409, 'Published results cannot be reopened');
    if (await RewardIssue.exists({ award_id: award._id, status: 'issued' }))
      return send(res, 409, 'Some rewards are already given, so the results cannot be reopened');

    await RewardIssue.deleteMany({ award_id: award._id, status: { $in: ['planned', 'cancelled'] } });
    await AwardResult.updateMany({ award_id: award._id },
      { $set: { status: 'calculated', finalized_at: null, finalized_by: '' } });
    await AwardWorkflow.deleteOne({ award_id: award._id });
    res.json({ success: true, message: 'Results reopened. Re-evaluate or change them, then finalize again.' });
  } catch (err) { fail(req, res, err); }
});

// ── GET /analytics ─────────────────────────────────────────────────────────
router.get('/analytics', async (req, res) => {
  try {
    const [byStatus, wfByStatus, wfPublished, budgetRows] = await Promise.all([
      AwardDefinition.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      AwardWorkflow.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      AwardWorkflow.find({ status: 'published' }).select('award_id').lean(),
      RewardIssue.aggregate([{ $match: { status: { $in: ['planned', 'issued'] } } },
        { $group: { _id: '$status', cost: { $sum: '$total_cost' } } }]),
    ]);
    const pubIds = wfPublished.map((w) => w.award_id);
    const [pubAwards, pubRows] = await Promise.all([
      AwardDefinition.find({ _id: { $in: pubIds } }).select('winners').lean(),
      AwardResult.find({ award_id: { $in: pubIds }, status: 'finalized', final_rank: { $ne: null } }).lean(),
    ]);
    const awardBy = new Map(pubAwards.map((a) => [String(a._id), a]));
    const winners = pubRows.filter((r) => winnersOf(awardBy.get(String(r.award_id)), [r]).length);

    const dept = new Map(), emp = new Map();
    winners.forEach((w) => {
      const d = w.department || 'Unassigned';
      dept.set(d, (dept.get(d) || 0) + 1);
      if (w.entity_type === 'employee') {
        const k = String(w.employee_id);
        const e = emp.get(k) || { name: w.entity_name, code: w.employee_code, department: w.department, wins: 0 };
        e.wins += 1; emp.set(k, e);
      }
    });
    const n = (rows, key) => rows.find((r) => r._id === key)?.n || 0;
    res.json({ success: true, data: {
      awards: { draft: n(byStatus, 'draft'), active: n(byStatus, 'active'), closed: n(byStatus, 'closed') },
      approvals: { in_review: n(wfByStatus, 'in_review'), approved: n(wfByStatus, 'approved'),
                   returned: n(wfByStatus, 'returned'), published: n(wfByStatus, 'published') },
      winners_total: winners.length,
      by_department: [...dept].map(([department, count]) => ({ department, count })).sort((a, b) => b.count - a.count),
      leaderboard: [...emp.values()].sort((a, b) => b.wins - a.wins).slice(0, 10),
      budget: { planned: budgetRows.find((r) => r._id === 'planned')?.cost || 0, issued: budgetRows.find((r) => r._id === 'issued')?.cost || 0 },
    } });
  } catch (err) { fail(req, res, err); }
});

module.exports = router;