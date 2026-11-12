// routes/rewards.js  Phase 4: reward catalogue, register, stock, budget
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const AwardDefinition = require('../models/AwardDefinition');
const AwardResult = require('../models/AwardResult');
const RewardItem = require('../models/RewardItem');
const RewardIssue = require('../models/RewardIssue');
const C = require('../constants/awardMetrics');
const auth = require('../middleware/auth');
const hrOnly = require('../middleware/hrOnly');
const AwardWorkflow = require('../models/AwardWorkflow');

router.use(auth, hrOnly);

const NEEDS_ITEM = new Set(C.REWARD_TYPES.filter((t) => t !== 'cash' && t !== 'points'));
const actorName = (req) => req.actor?.name || req.user?.name || '';
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const send = (res, status, message) => res.status(status).json({ success: false, message });
const fail = (req, res, err) => {
  console.error(`[rewards] ${req.method} ${req.originalUrl} failed:`, err);
  return send(res, err.status || 500, err.message);
};
const validId = (res, id, what = 'Record') => {
  if (!mongoose.isValidObjectId(id)) { send(res, 404, `${what} not found`); return false; }
  return true;
};
const logEntry = (delta, reason, ref, by) => ({ $push: { stock_log: { $each: [{ delta, reason, ref, by, at: new Date() }], $slice: -100 } } });

// ───────────────────────── catalogue ─────────────────────────
router.get('/items', async (req, res) => {
  try {
    const items = await RewardItem.find().select('-stock_log').sort({ active: -1, reward_type: 1, name: 1 }).lean();
    res.json({ success: true, data: items });
  } catch (err) { fail(req, res, err); }
});

router.post('/items', async (req, res) => {
  try {
    const b = req.body || {};
    if (!NEEDS_ITEM.has(b.reward_type)) return send(res, 400, 'Choose a valid reward type');
    const name = String(b.name || '').trim();
    if (name.length < 2) return send(res, 400, 'Enter an item name');
    const unit_cost = Number(b.unit_cost) || 0, stock = Math.floor(Number(b.stock_on_hand) || 0), low = Math.floor(Number(b.low_stock_at) || 0);
    if (unit_cost < 0 || stock < 0 || low < 0) return send(res, 400, 'Cost and stock cannot be negative');
    const item = await RewardItem.create({
      name, reward_type: b.reward_type, unit_cost, stock_on_hand: stock, low_stock_at: low,
      stock_log: stock ? [{ delta: stock, reason: 'Opening stock', by: actorName(req) }] : [],
    });
    res.status(201).json({ success: true, data: item });
  } catch (err) { fail(req, res, err); }
});

router.put('/items/:id', async (req, res) => {
  try {
    if (!validId(res, req.params.id, 'Item')) return;
    const b = req.body || {}, set = {};
    if (b.name !== undefined) { const n = String(b.name).trim(); if (n.length < 2) return send(res, 400, 'Enter an item name'); set.name = n; }
    if (b.unit_cost !== undefined) { const v = Number(b.unit_cost); if (!(v >= 0)) return send(res, 400, 'Cost cannot be negative'); set.unit_cost = v; }
    if (b.low_stock_at !== undefined) { const v = Math.floor(Number(b.low_stock_at)); if (!(v >= 0)) return send(res, 400, 'Low-stock level cannot be negative'); set.low_stock_at = v; }
    if (b.active !== undefined) set.active = !!b.active;
    const item = await RewardItem.findByIdAndUpdate(req.params.id, { $set: set }, { new: true }).select('-stock_log');
    if (!item) return send(res, 404, 'Item not found');
    res.json({ success: true, data: item });
  } catch (err) { fail(req, res, err); }
});

// add stock (qty > 0) or correct it (qty < 0, cannot go below zero)
router.post('/items/:id/restock', async (req, res) => {
  try {
    if (!validId(res, req.params.id, 'Item')) return;
    const qty = Math.trunc(Number(req.body?.qty));
    const note = String(req.body?.note || '').trim();
    if (!qty) return send(res, 400, 'Enter a quantity (use a minus number to reduce stock)');
    if (qty < 0 && note.length < 3) return send(res, 400, 'Give a reason when reducing stock');
    const filter = { _id: req.params.id };
    if (qty < 0) filter.stock_on_hand = { $gte: -qty };
    const item = await RewardItem.findOneAndUpdate(filter,
      { $inc: { stock_on_hand: qty }, ...logEntry(qty, note || 'Stock added', '', actorName(req)) },
      { new: true }).select('-stock_log');
    if (!item) return send(res, 409, 'Not enough stock to reduce by that much');
    res.json({ success: true, data: item });
  } catch (err) { fail(req, res, err); }
});

// ───────────────────────── generate register entries from finalized results ─────────────────────────
router.post('/awards/:awardId/generate', async (req, res) => {
  try {
    if (!validId(res, req.params.awardId, 'Award')) return;
    const award = await AwardDefinition.findById(req.params.awardId).lean();
    if (!award) return send(res, 404, 'Award not found');
    if (!award.rewards?.length) return send(res, 400, 'This award has no reward lines');

    const results = await AwardResult.find({ award_id: award._id, status: 'finalized', final_rank: { $ne: null } }).lean();
    if (!results.length) return send(res, 409, 'Finalize the award results first. There are no finalized winners yet.');
        const wf = await AwardWorkflow.findOne({ award_id: award._id }).select('status').lean();
    if (!wf || !['approved', 'published'].includes(wf.status))
      return send(res, 409, 'Get the results approved first (Award Approvals), then create reward entries.');

    const items = await RewardItem.find({ active: true }).sort({ stock_on_hand: -1 }).lean();
    const itemFor = new Map();
    items.forEach((i) => { if (!itemFor.has(i.reward_type)) itemFor.set(i.reward_type, i); });

    const topN = award.winners?.mode === 'top_n';
    const count = award.winners?.count || 0;
    const ops = [];
    award.rewards.forEach((line, idx) => {
      let upper = line.rank_to > 0 ? line.rank_to : Infinity;
      if (topN) upper = Math.min(upper, count);
      results.filter((r) => r.final_rank >= (line.rank_from || 1) && r.final_rank <= upper).forEach((r) => {
        const item = NEEDS_ITEM.has(line.type) ? itemFor.get(line.type) : null;
        const unit = item?.unit_cost || 0;
        ops.push({ updateOne: {
          filter: { award_id: award._id, entity_key: r.entity_key, line_index: idx },
          update: { $setOnInsert: {
            award_name: award.name, result_id: r._id, entity_type: r.entity_type, employee_id: r.employee_id,
            department: r.department, entity_name: r.entity_name, employee_code: r.employee_code,
            rank: r.final_rank, reward_type: line.type, title: line.title || '',
            item_id: item?._id || null, item_name: item?.name || '', quantity: 1, unit_cost: unit,
            cash_amount: line.cash_amount || 0, points: line.points || 0,
            total_cost: (line.cash_amount || 0) + unit, status: 'planned',
          } },
          upsert: true,
        } });
      });
    });
    if (!ops.length) return send(res, 409, 'No winners match the reward lines of this award');

    const out = await RewardIssue.bulkWrite(ops);
    const agg = await RewardIssue.aggregate([
      { $match: { award_id: award._id, status: { $ne: 'cancelled' } } },
      { $group: { _id: null, cost: { $sum: '$total_cost' } } },
    ]);
    const total = agg[0]?.cost || 0, budget = award.budget?.total || 0;
    res.json({ success: true, data: {
      created: out.upsertedCount, already_existed: ops.length - out.upsertedCount,
      total_cost: total, budget, over_budget: budget > 0 && total > budget,
    } });
  } catch (err) { fail(req, res, err); }
});

// ───────────────────────── register ─────────────────────────
router.get('/register', async (req, res) => {
  try {
    const f = {};
    if (mongoose.isValidObjectId(req.query.award_id)) f.award_id = req.query.award_id;
    if (['planned', 'issued', 'cancelled'].includes(req.query.status)) f.status = req.query.status;
    if (req.query.type) f.reward_type = String(req.query.type);
    if (req.query.q) f.entity_name = { $regex: esc(String(req.query.q).trim()), $options: 'i' };
    const issues = await RewardIssue.find(f).sort({ createdAt: -1 }).limit(500).lean();
    const live = issues.filter((i) => i.status !== 'cancelled');
    res.json({ success: true, data: {
      issues,
      totals: {
        planned: issues.filter((i) => i.status === 'planned').length,
        issued: issues.filter((i) => i.status === 'issued').length,
        cash_pending: live.filter((i) => i.status === 'planned').reduce((s, i) => s + i.cash_amount, 0),
        cash_given: live.filter((i) => i.status === 'issued').reduce((s, i) => s + i.cash_amount, 0),
      },
    } });
  } catch (err) { fail(req, res, err); }
});

// change item or quantity of a planned reward
router.put('/issues/:id', async (req, res) => {
  try {
    if (!validId(res, req.params.id, 'Reward entry')) return;
    const issue = await RewardIssue.findById(req.params.id);
    if (!issue) return send(res, 404, 'Reward entry not found');
    if (issue.status !== 'planned') return send(res, 409, 'Only planned rewards can be edited');

    const b = req.body || {};
    if (b.quantity !== undefined) {
      const q = Math.floor(Number(b.quantity));
      if (!(q >= 1 && q <= 100)) return send(res, 400, 'Quantity must be between 1 and 100');
      issue.quantity = q;
    }
    if (b.item_id !== undefined) {
      if (!b.item_id) { issue.item_id = null; issue.item_name = ''; issue.unit_cost = 0; }
      else {
        if (!mongoose.isValidObjectId(b.item_id)) return send(res, 400, 'Invalid item');
        const item = await RewardItem.findById(b.item_id).lean();
        if (!item || !item.active) return send(res, 400, 'Item not found or inactive');
        if (item.reward_type !== issue.reward_type) return send(res, 400, 'That item is a different reward type');
        issue.item_id = item._id; issue.item_name = item.name; issue.unit_cost = item.unit_cost;
      }
    }
    if (b.note !== undefined) issue.note = String(b.note).slice(0, 300);
    issue.total_cost = issue.cash_amount + issue.quantity * issue.unit_cost;
    await issue.save();
    res.json({ success: true, data: issue });
  } catch (err) { fail(req, res, err); }
});

// mark as given. Takes stock out if an item is linked
router.post('/issues/:id/issue', async (req, res) => {
  try {
    if (!validId(res, req.params.id, 'Reward entry')) return;
    const issue = await RewardIssue.findById(req.params.id).lean();
    if (!issue) return send(res, 404, 'Reward entry not found');
    if (issue.status !== 'planned') return send(res, 409, 'This reward is already handled');

    let deducted = false;
    if (issue.item_id) {
      const item = await RewardItem.findOneAndUpdate(
        { _id: issue.item_id, stock_on_hand: { $gte: issue.quantity } },
        { $inc: { stock_on_hand: -issue.quantity },
          ...logEntry(-issue.quantity, `Given to ${issue.entity_name}`, String(issue._id), actorName(req)) },
        { new: true });
      if (!item) return send(res, 409, `Not enough stock of "${issue.item_name}". Add stock first.`);
      deducted = true;
    }
    const claimed = await RewardIssue.findOneAndUpdate(
      { _id: issue._id, status: 'planned' },
      { $set: { status: 'issued', issued_at: new Date(), issued_by: actorName(req),
          note: String(req.body?.note || issue.note || '').slice(0, 300),
          payment_ref: String(req.body?.payment_ref || '').slice(0, 100) } },
      { new: true });
    if (!claimed) {      // someone else handled it first, put the stock back
      if (deducted) await RewardItem.updateOne({ _id: issue.item_id },
        { $inc: { stock_on_hand: issue.quantity }, ...logEntry(issue.quantity, 'Reverted (already handled)', String(issue._id), actorName(req)) });
      return send(res, 409, 'This reward is already handled');
    }
    res.json({ success: true, data: claimed });
  } catch (err) { fail(req, res, err); }
});

router.post('/issues/:id/cancel', async (req, res) => {
  try {
    if (!validId(res, req.params.id, 'Reward entry')) return;
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 5) return send(res, 400, 'Please give a reason (at least 5 characters)');
    const issue = await RewardIssue.findOneAndUpdate(
      { _id: req.params.id, status: 'planned' },
      { $set: { status: 'cancelled', cancel_reason: reason } }, { new: true });
    if (!issue) return send(res, 409, 'Only planned rewards can be cancelled');
    res.json({ success: true, data: issue });
  } catch (err) { fail(req, res, err); }
});

// ───────────────────────── budget and stock summary ─────────────────────────
router.get('/summary', async (req, res) => {
  try {
    const rows = await RewardIssue.aggregate([
      { $match: { status: { $in: ['planned', 'issued'] } } },
      { $group: { _id: { a: '$award_id', s: '$status' }, cost: { $sum: '$total_cost' }, n: { $sum: 1 } } },
    ]);
    const per = new Map();
    rows.forEach(({ _id, cost, n }) => {
      const k = String(_id.a);
      if (!per.has(k)) per.set(k, { planned_cost: 0, issued_cost: 0, planned_count: 0, issued_count: 0 });
      const p = per.get(k);
      p[`${_id.s}_cost`] = cost; p[`${_id.s}_count`] = n;
    });
    const awards = await AwardDefinition.find({ $or: [
      { _id: { $in: [...per.keys()] } }, { 'budget.total': { $gt: 0 }, status: { $ne: 'draft' } },
    ] }).select('name status budget.total').lean();

    const list = awards.map((a) => {
      const p = per.get(String(a._id)) || { planned_cost: 0, issued_cost: 0, planned_count: 0, issued_count: 0 };
      const budget = a.budget?.total || 0, committed = p.planned_cost + p.issued_cost;
      return { award_id: a._id, name: a.name, status: a.status, budget, ...p,
        remaining: budget ? budget - committed : null, over_budget: budget > 0 && committed > budget };
    }).sort((x, y) => x.name.localeCompare(y.name));

    const items = await RewardItem.find({ active: true }).select('name reward_type stock_on_hand low_stock_at').lean();
    res.json({ success: true, data: {
      awards: list,
      totals: {
        budget: list.reduce((s, a) => s + a.budget, 0),
        planned: list.reduce((s, a) => s + a.planned_cost, 0),
        issued: list.reduce((s, a) => s + a.issued_cost, 0),
      },
      low_stock: items.filter((i) => i.stock_on_hand <= i.low_stock_at),
    } });
  } catch (err) { fail(req, res, err); }
});

module.exports = router;