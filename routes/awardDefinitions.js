// routes/awardDefinitions.js
// Award & Scheme configuration (Phase 1).
// Lifecycle:  draft  --launch-->  active  --close-->  closed
//   - Only DRAFT awards can be edited. Any award can be deleted unless winners are published or rewards are issued.
//   - Active/closed awards are locked. Use "clone" to make next month's copy.
const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();

const AwardDefinition = require('../models/AwardDefinition');
const C = require('../constants/awardMetrics');
const { validateAward, toDateStr } = require('../helpers/awardDefinitionValidator');
const auth = require('../middleware/auth');
const hrOnly = require('../middleware/hrOnly');
const DailyLog = require('../models/DailyLog');
const Employee = require('../models/Employee');
const KpiTemplate = require('../models/KpiTemplate');
const KpiAssignment = require('../models/KpiAssignment');
const { participantFilter } = require('../helpers/awardParticipants');
const { periodsBetween } = require('../helpers/metricResolvers');
const KpiMonthlyVersion = require('../models/KpiMonthlyVersion');
const AwardResult = require('../models/AwardResult');
const AwardWorkflow = require('../models/AwardWorkflow');
const RewardIssue = require('../models/RewardIssue');
const SchemeSource = require('../models/SchemeSource');

router.use(auth, hrOnly);

const actorName = (req) => req.actor?.name || req.user?.name || '';
const bad = (res, errors, warnings = []) =>
  res.status(400).json({
    success: false,
    message: errors[0] || 'Please fix the errors and try again',
    errors,
    warnings,
  });
// Prints the full stack in the backend terminal, so a vague message can be traced
const fail = (req, res, err, status = 400) => {
  console.error(`[award-definitions] ${req.method} ${req.originalUrl} failed:`, err);
  return res.status(status).json({ success: false, message: err.message });
};
const notFound = (res) => res.status(404).json({ success: false, message: 'Award not found' });
const locked = (res, status) =>
  res.status(409).json({
    success: false,
    message: `This award is ${status}, so it cannot be changed. Clone it to make a new version.`,
  });

async function findDoc(req, res) {
  if (!mongoose.isValidObjectId(req.params.id)) { notFound(res); return null; }
  const doc = await AwardDefinition.findById(req.params.id);
  if (!doc) { notFound(res); return null; }
  return doc;
}

// Same name + same start date = almost certainly a duplicate click
async function isDuplicate(name, start_date, excludeId) {
  if (!name || !start_date) return false;
  const q = { name, start_date };
  if (excludeId) q._id = { $ne: excludeId };
  return !!(await AwardDefinition.findOne(q).collation({ locale: 'en', strength: 2 }).select('_id'));
}

// ── GET /meta ─ lists for dropdowns + templates (keep BEFORE /:id) ──────────
router.get('/meta', (req, res) => {
  res.json({
    success: true,
    data: {
      metrics: C.METRICS,
      categories: C.CATEGORIES,
      frequencies: C.FREQUENCIES,
      participations: C.PARTICIPATIONS,
      rule_types: C.RULE_TYPES,
      winner_modes: C.WINNER_MODES,
      reward_types: C.REWARD_TYPES,
      tie_breakers: C.TIE_BREAKERS,
      approval_steps: C.APPROVAL_STEPS,
      presets: C.PRESETS,
    },
  });
});

// ── GET /daily-kpi-names ─ KPI names found in Daily Log (for the scheme form) ──
router.get('/daily-kpi-names', async (req, res) => {
  try {
    const names = await DailyLog.distinct('kpi_name', { isDeleted: { $ne: true } });
    res.json({ success: true, data: names.filter(Boolean).sort().slice(0, 300) });
  } catch (err) { fail(req, res, err, 500); }
});

// ── GET /active-kpis ─ KPIs of each participant's active assignment (read from the month version) ──
router.get('/active-kpis', async (req, res) => {
  try {
    const depts = String(req.query.departments || '').split(',').map((s) => s.trim()).filter(Boolean);
    const empIds = String(req.query.employee_ids || '').split(',').map((s) => s.trim()).filter((x) => /^[a-f\d]{24}$/i.test(x));
    const start = String(req.query.start || '').slice(0, 10);
    const end = String(req.query.end || '').slice(0, 10);
    const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && start <= end;

    const people = await Employee.find(participantFilter({ departments: depts, employee_ids: empIds })).select('_id').lean();
    const ids = people.map((p) => p._id);

    const find = (withPeriod) => {
      const f = { employee_id: { $in: ids }, status: 'active' };
      if (withPeriod && dateOk) f.period = { $in: periodsBetween(start, end) };
      return KpiAssignment.find(f).select('employee_id template_id period').lean();
    };
    let assigns = await find(true);
    if (!assigns.length && dateOk) assigns = await find(false);     // period text did not match, fall back to all active

    const tplIds = [...new Set(assigns.map((a) => String(a.template_id)))];
    const [versions, templates] = await Promise.all([
      KpiMonthlyVersion.find({ template_id: { $in: tplIds }, month_status: { $in: ['active', 'locked'] } })
        .select('template_id month kpi_items').lean(),
      KpiTemplate.find({ _id: { $in: tplIds } }).select('kpi_items').lean(),
    ]);
    const vBy = new Map(versions.map((v) => [`${v.template_id}|${String(v.month).toLowerCase()}`, v]));
    const tBy = new Map(templates.map((t) => [String(t._id), t]));

    const map = new Map();
    assigns.forEach((a) => {
      const v = vBy.get(`${a.template_id}|${String(a.period).toLowerCase()}`);   // the month version is what the employee really works on
      const items = v ? v.kpi_items : (tBy.get(String(a.template_id))?.kpi_items || []);
      items.forEach((i) => {
        const name = String(i.kpi_name || '').trim();
        if (!name) return;
        const key = name.toLowerCase();
        if (!map.has(key)) map.set(key, { kpi_name: name, target: i.target, frequency: i.frequency, emps: new Set() });
        map.get(key).emps.add(String(a.employee_id));
      });
    });
    const kpis = [...map.values()]
      .map((k) => ({ kpi_name: k.kpi_name, target: k.target, frequency: k.frequency, employee_count: k.emps.size }))
      .sort((a, b) => a.kpi_name.localeCompare(b.kpi_name)).slice(0, 300);
    res.json({ success: true, data: { total_employees: ids.length, kpis } });
  } catch (err) { fail(req, res, err, 500); }
});

// ── GET /employees-lite ─ active employees for the participant picker ──
router.get('/employees-lite', async (req, res) => {
  try {
    const rows = await Employee.find({ status: { $in: ['approved', 'active'] } })
      .select('name employeeId department').sort({ name: 1 }).limit(3000).lean();
    res.json({ success: true, data: rows });
  } catch (err) { fail(req, res, err, 500); }
});

// ── GET / ─ list. ?status=&category=&q= ─────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { status, category, q } = req.query;
    const filter = {};
    if (C.STATUSES.includes(status)) filter.status = status;
    if (C.CATEGORIES.includes(category)) filter.category = category;
    if (q) filter.name = new RegExp(String(q).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

    const rows = await AwardDefinition.find(filter).sort({ start_date: -1, createdAt: -1 }).lean();
    const counts = await AwardDefinition.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]);
    const byStatus = { draft: 0, active: 0, closed: 0 };
    counts.forEach((c) => { byStatus[c._id] = c.n; });

    res.json({ success: true, data: rows, counts: byStatus });
  } catch (err) {
    fail(req, res, err, 500);
  }
});

// ── GET /:id ────────────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const doc = await findDoc(req, res);
    if (!doc) return;
    res.json({ success: true, data: doc });
  } catch (err) {
    fail(req, res, err, 500);
  }
});

// ── POST / ─ create a DRAFT ─────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { errors, warnings, data } = validateAward(req.body);
    if (errors.length) return bad(res, errors, warnings);
    if (await isDuplicate(data.name, data.start_date)) {
      return res.status(409).json({ success: false, message: 'An award with this name and start date already exists' });
    }
    const doc = await AwardDefinition.create({
      ...data, status: 'draft',
      created_by_name: actorName(req), updated_by_name: actorName(req),
    });
    res.status(201).json({ success: true, data: doc, warnings });
  } catch (err) {
    fail(req, res, err, 400);
  }
});

// ── PUT /:id ─ edit (draft only) ────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const doc = await findDoc(req, res);
    if (!doc) return;
    if (doc.status !== 'draft') return locked(res, doc.status);

    const { errors, warnings, data } = validateAward(req.body);
    if (errors.length) return bad(res, errors, warnings);
    if (await isDuplicate(data.name, data.start_date, doc._id)) {
      return res.status(409).json({ success: false, message: 'An award with this name and start date already exists' });
    }
    doc.set({ ...data, updated_by_name: actorName(req) });
    await doc.save();
    res.json({ success: true, data: doc, warnings });
  } catch (err) {
    fail(req, res, err, 400);
  }
});

// ── POST /:id/launch ─ draft -> active (strict checks) ──────────────────────
router.post('/:id/launch', async (req, res) => {
  try {
    const doc = await findDoc(req, res);
    if (!doc) return;
    if (doc.status !== 'draft') return locked(res, doc.status);

    const { errors, warnings } = validateAward(doc.toObject(), { forLaunch: true });
    if (errors.length) return bad(res, errors, warnings);

    doc.status = 'active';
    doc.launched_at = new Date();
    doc.updated_by_name = actorName(req);
    await doc.save();
    res.json({ success: true, data: doc, warnings });
  } catch (err) {
    fail(req, res, err, 400);
  }
});

// ── POST /:id/close ─ active -> closed ──────────────────────────────────────
router.post('/:id/close', async (req, res) => {
  try {
    const doc = await findDoc(req, res);
    if (!doc) return;
    if (doc.status !== 'active') {
      return res.status(409).json({ success: false, message: 'Only an active award can be closed' });
    }
    doc.status = 'closed';
    doc.closed_at = new Date();
    doc.close_reason = String(req.body?.reason || '').trim().slice(0, 300);
    doc.updated_by_name = actorName(req);
    await doc.save();
    res.json({ success: true, data: doc });
  } catch (err) {
    fail(req, res, err, 400);
  }
});

// ── POST /:id/clone ─ copy as a new DRAFT with new dates ────────────────────
// body: { start_date: 'YYYY-MM-DD', end_date: 'YYYY-MM-DD', name? }
router.post('/:id/clone', async (req, res) => {
  try {
    const src = await findDoc(req, res);
    if (!src) return;

    const base = src.toObject();
    const input = {
      ...base,
      name: req.body?.name || base.name,
      start_date: req.body?.start_date,
      end_date: req.body?.end_date,
    };
    const { errors, warnings, data } = validateAward(input);
    if (errors.length) return bad(res, errors, warnings);
    if (await isDuplicate(data.name, data.start_date)) {
      return res.status(409).json({ success: false, message: 'An award with this name and start date already exists' });
    }
    const doc = await AwardDefinition.create({
      ...data, status: 'draft', cloned_from: src._id,
      created_by_name: actorName(req), updated_by_name: actorName(req),
    });
    res.status(201).json({ success: true, data: doc, warnings });
  } catch (err) {
    fail(req, res, err, 400);
  }
});

// ── DELETE /:id ─ delete an award in any status ─────────────────────────────
// Blocked only when it already has real outcomes: published winners, or rewards already handed over.
// Otherwise the award and everything hanging off it (results, approval, planned rewards, scheme sources) is removed.
router.delete('/:id', async (req, res) => {
  try {
    const doc = await findDoc(req, res);
    if (!doc) return;

    if (await AwardWorkflow.exists({ award_id: doc._id, status: 'published' })) {
      return res.status(409).json({ success: false, message: 'Winners are already published for this award, so it cannot be deleted.' });
    }
    if (await RewardIssue.exists({ award_id: doc._id, status: 'issued' })) {
      return res.status(409).json({ success: false, message: 'Some rewards are already given for this award, so it cannot be deleted.' });
    }

    await Promise.all([
      AwardResult.deleteMany({ award_id: doc._id }),
      AwardWorkflow.deleteMany({ award_id: doc._id }),
      RewardIssue.deleteMany({ award_id: doc._id }),
      SchemeSource.deleteMany({ award_id: doc._id }),
    ]);
    await doc.deleteOne();
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    fail(req, res, err, 500);
  }
});

module.exports = router;