// routes/lifeGrowthRoutes.js
// Radnus PMS - Life Growth Path (Phase 1: vision, goals, privacy, sharing, catalogue admin)
// Mounted at /api/life-growth.
//
// Rules enforced here:
//  - every route needs a valid login token (middleware/auth)
//  - employee_id ALWAYS comes from the token, never from URL/body
//  - goals are private by default; the EMPLOYEE decides who sees a goal (Team Lead and/or HR)
//    and how much (summary or full). Access exists only through an active, unrevoked share.
//  - HR/admin can manage the catalogue, but can read a goal only when the employee shared it with HR
//  - nothing here reads or writes salary, KPI, appraisal or promotion data
const express = require('express');
const mongoose = require('mongoose');
const auth = require('../middleware/auth');
const Employee = require('../models/Employee');
const KpiLeaderMapping = require('../models/KpiLeaderMapping');
const LifeVision = require('../models/LifeVision');
const LifeGoalCatalogue = require('../models/LifeGoalCatalogue');
const LifeGoal = require('../models/LifeGoal');
const LifeGoalRevision = require('../models/LifeGoalRevision');
const LifeGoalShare = require('../models/LifeGoalShare');
const LifeGrowthAudit = require('../models/LifeGrowthAudit');
const { encrypt, decrypt } = require('../helpers/lifeGrowthCrypto');
const V = require('../helpers/lifeGrowthValidators');

const router = express.Router();

/* ───────────── gates ───────────── */

const isStaff = (req) => ['hr', 'admin'].includes(req.user?.role);

router.use(auth);

// feature flag + optional pilot list (LIFE_GROWTH_PILOT_IDS = comma separated Employee _ids)
router.use((req, res, next) => {
  const off = () => res.status(404).json({ success: false, message: 'Life Growth is not available' });
  if (process.env.LIFE_GROWTH_ENABLED !== 'true') return off();
  const pilot = (process.env.LIFE_GROWTH_PILOT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (pilot.length && !isStaff(req) && !pilot.includes(String(req.user.id))) return off();
  next();
});

const employeeOnly = (req, res, next) => {
  if (isStaff(req) || !mongoose.isValidObjectId(req.user.id)) {
    return res.status(403).json({ success: false, message: 'Employee access only' });
  }
  next();
};

const hrOnly = (req, res, next) => {
  if (isStaff(req)) return next();
  return res.status(403).json({ success: false, message: 'HR only' });
};

// async wrapper: consistent errors, never leaks internals
const h = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (e) {
    if (e instanceof V.ValidationError) return res.status(e.status).json({ success: false, message: e.message });
    if (e && e.code === 11000) return res.status(409).json({ success: false, message: 'This conflicts with an existing record' });
    console.error('[life-growth]', e && e.message);
    res.status(500).json({ success: false, message: 'Something went wrong' });
  }
};

const notFound = (res) => res.status(404).json({ success: false, message: 'Not found' });

const audit = (req, action, extra = {}) =>
  LifeGrowthAudit.create({
    actor_id: String(req.user.id),
    actor_role: req.user.role || 'employee',
    action,
    ...extra,
  }).catch((e) => console.error('[life-growth] audit failed:', e.message));

/* ───────────── helpers ───────────── */

const activeRoadmap = (employeeId) => LifeVision.findOne({ employee_id: employeeId, status: 'active' });

async function findOwnGoal(req) {
  const id = String(req.params.id);
  if (!mongoose.isValidObjectId(id)) return null;
  return LifeGoal.findOne({ _id: id, employee_id: req.user.id });
}

// scope: 'owner' | 'full' => everything. 'summary' => no description, amounts, notes, next action.
function goalDto(g, scope = 'owner') {
  const base = {
    _id: g._id,
    stage_number: g.stage_number,
    title: g.title,
    category: g.category,
    status: g.status,
    priority: g.priority,
    is_primary: g.is_primary,
    current_progress: g.current_progress,
    start_date: g.start_date,
    target_date: g.target_date,
    visibility: g.visibility,
    completed_at: g.completed_at,
  };
  if (scope === 'summary') return base;
  return {
    ...base,
    description: g.description,
    next_action: g.next_action,
    catalogue_goal_id: g.catalogue_goal_id,
    target_amount: V.paiseToRupees(decrypt(g.target_amount_enc)),
    monthly_contribution: V.paiseToRupees(decrypt(g.monthly_contribution_enc)),
    notes: decrypt(g.notes_enc) || '',
    createdAt: g.createdAt,
  };
}

async function logRevision(goal, changed, before, after, req) {
  if (!changed.length) return;
  await LifeGoalRevision.create({
    goal_id: goal._id,
    employee_id: goal.employee_id,
    changed_fields: changed,
    before,
    after,
    changed_by: String(req.user.id),
  });
}

/* ───────────── reference data (any logged-in user) ───────────── */

router.get('/stages', (req, res) => res.json({ success: true, data: V.STAGES, categories: V.CATEGORIES }));

router.get('/catalogue', h(async (req, res) => {
  const q = { is_active: true };
  if (req.query.stage !== undefined) q.stage_number = V.parseStage(String(req.query.stage), { required: true });
  const data = await LifeGoalCatalogue.find(q).sort({ stage_number: 1, display_order: 1 });
  res.json({ success: true, data });
}));

/* ───────────── employee: vision ───────────── */

router.get('/my-vision', employeeOnly, h(async (req, res) => {
  const vision = await activeRoadmap(req.user.id);
  res.json({ success: true, data: vision });
}));

router.get('/my-vision/history', employeeOnly, h(async (req, res) => {
  const data = await LifeVision.find({ employee_id: req.user.id, status: 'archived' }).sort({ version: -1 });
  res.json({ success: true, data });
}));

// create a roadmap. If one is active, send { start_new: true } to archive it and begin version n+1.
router.post('/my-vision', employeeOnly, h(async (req, res) => {
  const body = req.body || {};
  const fields = V.parseVision(body);
  const existing = await activeRoadmap(req.user.id);
  let version = 1;
  if (existing) {
    if (body.start_new !== true) throw new V.ValidationError('You already have an active roadmap', 409);
    existing.status = 'archived';
    existing.roadmap_end_date = new Date();
    await existing.save();
    version = existing.version + 1;
    await audit(req, 'roadmap_archived', { target_type: 'roadmap', target_id: String(existing._id), employee_id: String(req.user.id) });
  }
  const vision = await LifeVision.create({ employee_id: req.user.id, ...fields, version });
  res.status(201).json({ success: true, data: vision });
}));

router.patch('/my-vision', employeeOnly, h(async (req, res) => {
  const vision = await activeRoadmap(req.user.id);
  if (!vision) return notFound(res);
  const fields = V.parseVision(req.body, { partial: true });
  Object.assign(vision, fields);
  await vision.save();
  res.json({ success: true, data: vision });
}));

/* ───────────── employee: goals ───────────── */

router.get('/my-goals', employeeOnly, h(async (req, res) => {
  const roadmap = await activeRoadmap(req.user.id);
  if (!roadmap) return res.json({ success: true, data: [] });
  const q = { employee_id: req.user.id, roadmap_id: roadmap._id };
  if (req.query.stage !== undefined) q.stage_number = V.parseStage(String(req.query.stage), { required: true });
  if (req.query.status !== undefined) {
    const s = String(req.query.status);
    if (!V.STATUSES.includes(s)) throw new V.ValidationError('Status is invalid');
    q.status = s;
  }
  const goals = await LifeGoal.find(q).sort({ stage_number: 1, is_primary: -1, createdAt: 1 });
  const shared = await sharedWithMap(goals.map((g) => g._id));
  res.json({ success: true, data: goals.map((g) => ({ ...goalDto(g), shared_with: shared.get(String(g._id)) || [] })) });
}));

router.post('/my-goals', employeeOnly, h(async (req, res) => {
  const b = req.body || {};
  const roadmap = await activeRoadmap(req.user.id);
  if (!roadmap) throw new V.ValidationError('Create your Life Vision first', 409);

  const stage = V.parseStage(b.stage_number, { required: !!b.catalogue_goal_id });

  let title, description, category, catalogueId = null;
  if (b.catalogue_goal_id) {
    const cid = V.parseObjectId(b.catalogue_goal_id, 'Goal option');
    const item = await LifeGoalCatalogue.findOne({ _id: cid, is_active: true });
    if (!item) throw new V.ValidationError('This goal option is no longer available', 409);
    if (item.stage_number !== stage) throw new V.ValidationError('This goal option does not belong to the chosen stage');
    catalogueId = item._id;
    title = item.goal_title;
    description = item.goal_description;
    category = item.goal_category;
  } else {
    title = V.cleanText(b.title, { field: 'Title', max: 120, required: true });
    description = V.cleanText(b.description, { field: 'Description', max: 1000 }) || '';
    category = V.parseCategory(b.category, true);
  }

  // one live primary goal per stage
  let isPrimary = false;
  if (stage) {
    const existing = await LifeGoal.findOne({ roadmap_id: roadmap._id, stage_number: stage, is_current_primary: true }).select('_id');
    if (b.is_primary === true) {
      if (existing) throw new V.ValidationError('This stage already has a primary goal. Use "make primary" to replace it.', 409);
      isPrimary = true;
    } else if (b.is_primary === undefined && !existing) {
      isPrimary = true;
    }
  } else if (b.is_primary === true) {
    throw new V.ValidationError('Choose a stage to set a primary goal');
  }

  const start = V.parseDate(b.start_date, 'Start date') || V.today();
  const target = V.parseDate(b.target_date, 'Target date', true);
  if (target < start) throw new V.ValidationError('Target date cannot be before the start date');

  const amount = V.parseAmount(b.target_amount, 'Target amount');
  const monthly = V.parseAmount(b.monthly_contribution, 'Monthly contribution');
  const notes = V.cleanText(b.notes, { field: 'Notes', max: 1000 });

  const goal = await LifeGoal.create({
    employee_id: req.user.id,
    roadmap_id: roadmap._id,
    catalogue_goal_id: catalogueId,
    stage_number: stage,
    title,
    description,
    category,
    is_primary: isPrimary,
    priority: V.parsePriority(b.priority) || 'medium',
    start_date: start,
    target_date: target,
    target_amount_enc: amount != null ? encrypt(amount) : null,
    monthly_contribution_enc: monthly != null ? encrypt(monthly) : null,
    notes_enc: notes ? encrypt(notes) : null,
    next_action: V.cleanText(b.next_action, { field: 'Next action', max: 300 }) || '',
    status: 'planned',
    visibility: 'private',
    current_progress: 0,
  });
  res.status(201).json({ success: true, data: goalDto(goal) });
}));

router.get('/my-goals/:id', employeeOnly, h(async (req, res) => {
  const goal = await findOwnGoal(req);
  if (!goal) return notFound(res);
  const revisions = await LifeGoalRevision.find({ goal_id: goal._id }).sort({ createdAt: -1 }).limit(50)
    .select('changed_fields createdAt');
  res.json({ success: true, data: goalDto(goal), revisions });
}));

// Permanently delete one of my goals. The goal, its shares and edit history are removed;
// only an anonymous audit entry stays (no title, amounts or notes).
router.delete('/my-goals/:id', employeeOnly, h(async (req, res) => {
  const goal = await findOwnGoal(req);
  if (!goal) return notFound(res);
  await LifeGoalShare.deleteMany({ goal_id: goal._id });
  await LifeGoalRevision.deleteMany({ goal_id: goal._id });
  await LifeGoal.deleteOne({ _id: goal._id });
  await audit(req, 'goal_deleted', {
    target_type: 'goal', target_id: String(goal._id), employee_id: String(req.user.id), meta: { status: goal.status },
  });
  res.json({ success: true });
}));

router.patch('/my-goals/:id', employeeOnly, h(async (req, res) => {
  const goal = await findOwnGoal(req);
  if (!goal) return notFound(res);
  if (V.TERMINAL_STATUSES.includes(goal.status)) throw new V.ValidationError('This goal is closed and cannot be edited', 409);

  const b = req.body || {};
  const before = {};
  const after = {};
  const changed = [];

  const setPlain = (field, value) => {
    if (value === undefined) return;
    const prev = goal[field];
    const same = prev instanceof Date && value instanceof Date ? prev.getTime() === value.getTime() : String(prev ?? '') === String(value ?? '');
    if (same) return;
    before[field] = prev;
    after[field] = value;
    goal[field] = value;
    changed.push(field);
  };
  const setSecret = (field, name, value) => {
    if (value === undefined) return;
    goal[field] = value === null || value === '' ? null : encrypt(value);
    changed.push(name); // value itself is never logged
  };

  if (b.title !== undefined) {
    if (goal.catalogue_goal_id) throw new V.ValidationError('The title of a standard goal cannot be changed. Use notes or description.');
    setPlain('title', V.cleanText(b.title, { field: 'Title', max: 120, required: true }));
  }
  setPlain('description', V.cleanText(b.description, { field: 'Description', max: 1000 }));
  setPlain('next_action', V.cleanText(b.next_action, { field: 'Next action', max: 300 }));
  setPlain('priority', V.parsePriority(b.priority));
  setPlain('current_progress', V.parseProgress(b.current_progress));

  const start = V.parseDate(b.start_date, 'Start date');
  const target = V.parseDate(b.target_date, 'Target date');
  setPlain('start_date', start);
  setPlain('target_date', target);
  if (goal.target_date < goal.start_date) throw new V.ValidationError('Target date cannot be before the start date');

  const amount = V.parseAmount(b.target_amount, 'Target amount');
  const monthly = V.parseAmount(b.monthly_contribution, 'Monthly contribution');
  const notes = V.cleanText(b.notes, { field: 'Notes', max: 1000 });
  setSecret('target_amount_enc', 'target_amount', amount);
  setSecret('monthly_contribution_enc', 'monthly_contribution', monthly);
  setSecret('notes_enc', 'notes', notes);

  if (changed.length) {
    await goal.save();
    await logRevision(goal, changed, before, after, req);
  }
  res.json({ success: true, data: goalDto(goal) });
}));

// start / pause / resume / complete / cancel
Object.entries(V.ACTIONS).forEach(([name, rule]) => {
  router.post(`/my-goals/:id/${name}`, employeeOnly, h(async (req, res) => {
    const goal = await findOwnGoal(req);
    if (!goal) return notFound(res);
    if (!rule.from.includes(goal.status)) {
      throw new V.ValidationError(`A goal that is "${goal.status}" cannot be ${name}ed`, 409);
    }
    const prev = goal.status;
    goal.status = rule.to;
    if (rule.to === 'completed') {
      goal.completed_at = new Date();
      goal.current_progress = 100;
    }
    await goal.save(); // pre-validate hook refreshes is_current_primary
    if (goal.visibility === 'shared' && rule.to === 'cancelled') {
      await LifeGoalShare.updateMany({ goal_id: goal._id, active: true }, { $set: { active: false, revoked_at: new Date() } });
      goal.visibility = 'private';
      await goal.save();
    }
    await logRevision(goal, ['status'], { status: prev }, { status: goal.status }, req);
    res.json({ success: true, data: goalDto(goal) });
  }));
});

// replace the stage's current primary goal with this one
router.post('/my-goals/:id/make-primary', employeeOnly, h(async (req, res) => {
  const goal = await findOwnGoal(req);
  if (!goal) return notFound(res);
  if (!goal.stage_number) throw new V.ValidationError('Only goals that belong to a stage can be primary');
  if (!V.ACTIVE_STATUSES.includes(goal.status)) throw new V.ValidationError('Only an open goal can be primary', 409);
  if (goal.is_primary) return res.json({ success: true, data: goalDto(goal) });

  const current = await LifeGoal.findOne({
    roadmap_id: goal.roadmap_id, stage_number: goal.stage_number, is_current_primary: true,
  });
  if (current) { current.is_primary = false; await current.save(); }
  try {
    goal.is_primary = true;
    await goal.save();
  } catch (e) {
    if (current) { current.is_primary = true; await current.save().catch(() => {}); } // put things back
    throw e;
  }
  await logRevision(goal, ['is_primary'], { is_primary: false }, { is_primary: true }, req);
  res.json({ success: true, data: goalDto(goal) });
}));

/* ───────────── employee: sharing (the employee decides who sees what) ───────────── */

async function myTeamLead(employeeId) {
  return KpiLeaderMapping.findOne({ isActive: true, member_ids: employeeId }).populate('leader_id', 'name');
}

// Map goalId -> [{ recipient: 'team_lead' | 'hr', scope }]
async function sharedWithMap(goalIds) {
  const map = new Map();
  if (!goalIds.length) return map;
  const shares = await LifeGoalShare.find({ goal_id: { $in: goalIds }, active: true }).select('goal_id grantee_type scope');
  shares.forEach((sh) => {
    const key = String(sh.goal_id);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ recipient: sh.grantee_type === 'hr' ? 'hr' : 'team_lead', scope: sh.scope });
  });
  return map;
}

router.get('/my-share-target', employeeOnly, h(async (req, res) => {
  const m = await myTeamLead(req.user.id);
  const ok = !!(m && m.leader_id && String(m.leader_id._id) !== String(req.user.id));
  res.json({ success: true, hasLeader: ok, leaderName: ok ? m.leader_id.name : '' });
}));

// body: { recipient: 'team_lead' | 'hr', scope: 'summary' | 'full' }. Calling again changes the scope.
router.post('/my-goals/:id/share', employeeOnly, h(async (req, res) => {
  const goal = await findOwnGoal(req);
  if (!goal) return notFound(res);
  if (goal.status === 'cancelled') throw new V.ValidationError('A cancelled goal cannot be shared', 409);
  const body = req.body || {};
  const recipient = V.parseRecipient(body.recipient);
  const scope = V.parseScope(body.scope);

  let filter;
  if (recipient === 'team_lead') {
    const m = await myTeamLead(req.user.id);
    if (!m || !m.leader_id || String(m.leader_id._id) === String(req.user.id)) {
      throw new V.ValidationError('You do not have a Team Lead to share with', 409);
    }
    filter = { goal_id: goal._id, grantee_id: m.leader_id._id, active: true };
  } else {
    filter = { goal_id: goal._id, grantee_type: 'hr', active: true };
  }

  await LifeGoalShare.findOneAndUpdate(
    filter,
    { $set: { scope, employee_id: req.user.id, grantee_type: recipient }, $setOnInsert: { granted_at: new Date() } },
    { upsert: true, new: true }
  );
  goal.visibility = 'shared';
  await goal.save();
  await audit(req, 'share_granted', {
    target_type: 'goal', target_id: String(goal._id), employee_id: String(req.user.id), meta: { recipient, scope },
  });
  res.json({ success: true, data: goalDto(goal) });
}));

// ?recipient=team_lead | hr | all (default all)
router.delete('/my-goals/:id/share', employeeOnly, h(async (req, res) => {
  const goal = await findOwnGoal(req);
  if (!goal) return notFound(res);
  const who = req.query.recipient === undefined ? 'all' : String(req.query.recipient);
  const q = { goal_id: goal._id, active: true };
  if (who === 'hr') q.grantee_type = 'hr';
  else if (who === 'team_lead') q.grantee_type = { $ne: 'hr' };
  else if (who !== 'all') throw new V.ValidationError('Recipient is invalid');

  const r = await LifeGoalShare.updateMany(q, { $set: { active: false, revoked_at: new Date() } });
  const remaining = await LifeGoalShare.countDocuments({ goal_id: goal._id, active: true });
  if (!remaining) { goal.visibility = 'private'; await goal.save(); }
  if (r.modifiedCount) {
    await audit(req, 'share_revoked', { target_type: 'goal', target_id: String(goal._id), employee_id: String(req.user.id), meta: { recipient: who } });
  }
  res.json({ success: true, data: goalDto(goal) });
}));

/* ───────────── readers of shared goals ───────────── */

// shares: LifeGoalShare docs already filtered to this reader. Applies each share's own scope.
async function sharedGoalList(req, shares, auditAction, actorRole) {
  if (!shares.length) return [];
  const [goals, employees] = await Promise.all([
    LifeGoal.find({ _id: { $in: shares.map((sh) => sh.goal_id) }, status: { $ne: 'cancelled' } }),
    Employee.find({ _id: { $in: shares.map((sh) => sh.employee_id) }, accessDeactivated: { $ne: true }, exitType: null })
      .select('name designation department'),
  ]);
  const empMap = new Map(employees.map((e) => [String(e._id), e]));
  const shareMap = new Map(shares.map((sh) => [String(sh.goal_id), sh]));

  const data = [];
  const logs = [];
  for (const g of goals) {
    const emp = empMap.get(String(g.employee_id));
    const sh = shareMap.get(String(g._id));
    if (!emp || !sh) continue;
    data.push({
      employee: { _id: emp._id, name: emp.name, designation: emp.designation, department: emp.department },
      scope: sh.scope,
      goal: goalDto(g, sh.scope),
    });
    logs.push({
      actor_id: String(req.user.id), actor_role: actorRole, action: auditAction,
      target_type: 'goal', target_id: String(g._id), employee_id: String(g.employee_id), meta: { scope: sh.scope },
    });
  }
  if (logs.length) await LifeGrowthAudit.insertMany(logs).catch((e) => console.error('[life-growth] audit failed:', e.message));
  return data;
}

// Team Lead: goals employees of MY team chose to share with me
router.get('/team/shared-goals', employeeOnly, h(async (req, res) => {
  const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true });
  if (!m) return res.json({ success: true, data: [] });
  const members = new Set(m.member_ids.map(String));
  members.delete(String(req.user.id));
  const shares = await LifeGoalShare.find({ grantee_id: req.user.id, grantee_type: { $ne: 'hr' }, active: true });
  const mine = shares.filter((sh) => members.has(String(sh.employee_id))); // still in my team
  res.json({ success: true, data: await sharedGoalList(req, mine, 'shared_goal_read', 'employee') });
}));

// HR: goals employees chose to share with HR (nothing else is readable by HR)
router.get('/hr/shared-goals', hrOnly, h(async (req, res) => {
  const shares = await LifeGoalShare.find({ grantee_type: 'hr', active: true });
  res.json({ success: true, data: await sharedGoalList(req, shares, 'hr_shared_goal_read', req.user.role || 'hr') });
}));

/* ───────────── HR / admin ───────────── */

router.get('/admin/catalogue', hrOnly, h(async (req, res) => {
  const q = {};
  if (req.query.stage !== undefined) q.stage_number = V.parseStage(String(req.query.stage), { required: true });
  const data = await LifeGoalCatalogue.find(q).sort({ stage_number: 1, is_active: -1, display_order: 1 });
  res.json({ success: true, data });
}));

async function activeCount(stage, ignoreId) {
  const q = { stage_number: stage, is_active: true };
  if (ignoreId) q._id = { $ne: ignoreId };
  return LifeGoalCatalogue.countDocuments(q);
}

router.post('/admin/catalogue', hrOnly, h(async (req, res) => {
  const b = req.body || {};
  const stage = V.parseStage(b.stage_number, { required: true });
  if ((await activeCount(stage)) >= 5) throw new V.ValidationError('This stage already has five active options. Deactivate one first.', 409);
  const order = Number(b.display_order);
  if (!Number.isInteger(order) || order < 1 || order > 5) throw new V.ValidationError('Display order must be 1 to 5');
  const doc = await LifeGoalCatalogue.create({
    stage_number: stage,
    stage_name: V.STAGES[stage - 1].stage_name,
    goal_title: V.cleanText(b.goal_title, { field: 'Title', max: 120, required: true }),
    goal_description: V.cleanText(b.goal_description, { field: 'Description', max: 1000 }) || '',
    goal_category: V.parseCategory(b.goal_category, true),
    display_order: order,
    is_active: true,
    updated_by: String(req.user.id),
  });
  await audit(req, 'catalogue_created', { target_type: 'catalogue', target_id: String(doc._id), meta: { stage } });
  res.status(201).json({ success: true, data: doc });
}));

router.patch('/admin/catalogue/:id', hrOnly, h(async (req, res) => {
  const id = V.parseObjectId(String(req.params.id), 'Id');
  const doc = await LifeGoalCatalogue.findById(id);
  if (!doc) return notFound(res);
  const b = req.body || {};

  const title = V.cleanText(b.goal_title, { field: 'Title', max: 120 });
  if (title) doc.goal_title = title;
  const desc = V.cleanText(b.goal_description, { field: 'Description', max: 1000 });
  if (desc !== undefined) doc.goal_description = desc;
  const cat = V.parseCategory(b.goal_category);
  if (cat) doc.goal_category = cat;
  if (b.display_order !== undefined) {
    const order = Number(b.display_order);
    if (!Number.isInteger(order) || order < 1 || order > 5) throw new V.ValidationError('Display order must be 1 to 5');
    doc.display_order = order;
  }
  if (b.is_active !== undefined) {
    if (typeof b.is_active !== 'boolean') throw new V.ValidationError('is_active must be true or false');
    if (b.is_active && !doc.is_active && (await activeCount(doc.stage_number, doc._id)) >= 5) {
      throw new V.ValidationError('This stage already has five active options', 409);
    }
    doc.is_active = b.is_active;
  }
  doc.updated_by = String(req.user.id);
  await doc.save();
  const active = await activeCount(doc.stage_number);
  await audit(req, 'catalogue_updated', { target_type: 'catalogue', target_id: String(doc._id), meta: { stage: doc.stage_number } });
  // existing employee goals keep their own snapshot, so nothing else changes
  res.json({ success: true, data: doc, activeInStage: active, warning: active !== 5 ? `Stage ${doc.stage_number} has ${active} active options (expected 5)` : undefined });
}));

module.exports = router;
