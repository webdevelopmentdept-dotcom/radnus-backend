const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KpiLeaderMapping = require('../models/KpiLeaderMapping');
const KpiAssignment = require('../models/KpiAssignment');
const Employee = require('../models/Employee');
const LeaveRequest = require('../models/LeaveRequest');
const DailyLog = require('../models/DailyLog');
const { createNotification } = require('../helpers/notificationHelper');

const hrOnly = (req, res, next) => {
  if (req.user && ['hr', 'admin'].includes(req.user.role)) return next();
  return res.status(403).json({ success: false, message: 'HR only' });
};

// one member -> only one active leader
async function findConflicts(memberIds, ignoreId) {
  const q = { isActive: true, member_ids: { $in: memberIds } };
  if (ignoreId) q._id = { $ne: ignoreId };
  return KpiLeaderMapping.find(q).populate('leader_id', 'name');
}

// permissions: missing / undefined = allowed (so old mappings keep working)
const normPerms = (p = {}) => ({
  kpi_view:       p.kpi_view !== false,
  leave_approval: p.leave_approval !== false,
});

// If a leader loses leave-approval (or a member / the whole team is removed),
// leave requests still waiting at the Team Lead stage go straight to HR so they never get stuck.
async function forwardPendingToHr(leaderId, memberIds) {
  const q = { tl_approver_id: leaderId, current_stage: 'team_lead', status: 'pending' };
  if (memberIds && memberIds.length) q.employee_id = { $in: memberIds };
  await LeaveRequest.updateMany(q, {
    $set: {
      current_stage: 'hr',
      tl_status: 'not_required',
      tl_approver_id: null,
      tl_remark: 'Team Lead no longer assigned - forwarded to HR',
    },
  });
}

// Notify the new Team Lead (optional) + the newly added members
async function notifyTeam({ leaderId, memberIds, teamSize, notifyLeader }) {
  try {
    const leader = await Employee.findById(leaderId).select('name');
    const leaderName = leader?.name || 'Your Team Lead';
    if (notifyLeader) {
      await createNotification({
        recipient_id:   String(leaderId),
        recipient_role: 'employee',
        type:           'team_assigned',
        title:          'You are now a Team Lead 👥',
        message:        `You are now Team Lead of ${teamSize} member${teamSize === 1 ? '' : 's'}.`,
        link:           '/employee/dashboard',
      });
    }
    for (const id of memberIds) {
      await createNotification({
        recipient_id:   String(id),
        recipient_role: 'employee',
        type:           'team_assigned',
        title:          'Your Team Lead 👥',
        message:        `${leaderName} is now your Team Lead.`,
        link:           '/employee/dashboard',
      });
    }
  } catch (e) {
    console.error('notifyTeam failed:', e.message);
  }
}

/* ───────────── LEADER SIDE (employee token) ───────────── */

// GET /api/kpi-leader/me  -> sidebar: show "My Team KPI" menu?
router.get('/me', auth, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true });
    res.json({
      success: true,
      isLeader: !!m,
      kpiAccess:   !!m && m.permissions?.kpi_view !== false,
      leaveAccess: !!m && m.permissions?.leave_approval !== false,
      teamSize: m ? m.member_ids.length : 0,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-leader/my-team  -> dashboard "My Team" card (leader only)
router.get('/my-team', auth, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true })
      .populate('member_ids', 'name designation department profileImage status exitType accessDeactivated');
    if (!m) return res.json({ success: true, isLeader: false });

    const members = m.member_ids.filter(e =>
      String(e._id) !== String(req.user.id) && !e.exitType && !e.accessDeactivated
    );
    const pendingLeaveCount = await LeaveRequest.countDocuments({
      tl_approver_id: req.user.id, current_stage: 'team_lead', status: 'pending',
    });

    res.json({
      success: true,
      isLeader: true,
      teamSize: members.length,
      permissions: {
        kpi_view:       m.permissions?.kpi_view !== false,
        leave_approval: m.permissions?.leave_approval !== false,
      },
      members: members.map(e => ({
        _id: e._id, name: e.name, designation: e.designation,
        department: e.department, profileImage: e.profileImage,
      })),
      pendingLeaveCount,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-leader/my-leader  -> dashboard "Your Team Lead" card (team member)
router.get('/my-leader', auth, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findOne({ isActive: true, member_ids: req.user.id })
      .populate('leader_id', 'name designation department profileImage');
    if (!m || !m.leader_id) return res.json({ success: true, hasLeader: false });
    res.json({
      success: true,
      hasLeader: true,
      leader: m.leader_id,
      leaveApproval: m.permissions?.leave_approval !== false,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-leader/team-assignments?employeeId=optional
router.get('/team-assignments', auth, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true })
      .populate('member_ids', 'name email department designation');
    if (!m) return res.status(403).json({ success: false, message: 'Not a team leader' });
    if (m.permissions?.kpi_view === false) {
      return res.status(403).json({ success: false, message: 'KPI access is not enabled for your team' });
    }

    // leader's own KPI is excluded
    const members = m.member_ids.filter(e => String(e._id) !== String(req.user.id));
    let ids = members.map(e => String(e._id));

    if (req.query.employeeId) {
      if (!ids.includes(req.query.employeeId)) {
        return res.status(403).json({ success: false, message: 'Not your team member' });
      }
      ids = [req.query.employeeId];
    }

    const data = await KpiAssignment.find({ employee_id: { $in: ids } })
      .populate('employee_id', 'name email department designation')
      .populate('template_id', 'template_name role department')
      .populate('month_version_id', 'month month_status kpi_items')
      .sort({ createdAt: -1 });

    res.json({ success: true, members, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-leader/team-logs/:assignmentId
// -> daily logs of one team member's KPI assignment (view only, leader's team members only)
router.get('/team-logs/:assignmentId', auth, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true });
    if (!m) return res.status(403).json({ success: false, message: 'Not a team leader' });
    if (m.permissions?.kpi_view === false) {
      return res.status(403).json({ success: false, message: 'KPI access is not enabled for your team' });
    }

    const a = await KpiAssignment.findById(req.params.assignmentId).select('employee_id');
    if (!a) return res.status(404).json({ success: false, message: 'Assignment not found' });

    const empId = String(a.employee_id);
    const isMember = m.member_ids.map(String).includes(empId) && empId !== String(req.user.id);
    if (!isMember) return res.status(403).json({ success: false, message: 'Not your team member' });

    const logs = await DailyLog.find({ employee_id: a.employee_id, assignment_id: a._id })
      .sort({ log_date: -1, createdAt: -1 });

    res.json({ success: true, logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

/* ───────────── HR SIDE ───────────── */

// GET /api/kpi-leader  -> all mappings
router.get('/', auth, hrOnly, async (req, res) => {
  try {
    const data = await KpiLeaderMapping.find({ isActive: true })
      .populate('leader_id', 'name email department designation')
      .populate('member_ids', 'name email department designation')
      .sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-leader/suggested-leaders -> designation says TL, but no team yet
router.get('/suggested-leaders', auth, hrOnly, async (req, res) => {
  try {
    const mapped = await KpiLeaderMapping.find({ isActive: true }).distinct('leader_id');
    const data = await Employee.find({
      _id: { $nin: mapped },
      designation: { $regex: /(team\s*lead|team\s*leader|\bTL\b)/i },
      status: { $in: ['approved', 'active'] },
      exitType: null,
    }).select('name email department designation');
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/kpi-leader  { leader_id, member_ids[] }
router.post('/', auth, hrOnly, async (req, res) => {
  try {
    const { leader_id } = req.body;
    const member_ids = [...new Set(req.body.member_ids || [])].filter(id => id !== leader_id);
    const permissions = normPerms(req.body.permissions);
    if (!leader_id || !member_ids.length) {
      return res.status(400).json({ success: false, message: 'Leader and at least 1 member required' });
    }
    if (!permissions.kpi_view && !permissions.leave_approval) {
      return res.status(400).json({ success: false, message: 'Select at least one access (KPI view / Leave approval)' });
    }
    if (await KpiLeaderMapping.findOne({ leader_id, isActive: true })) {
      return res.status(409).json({ success: false, message: 'This leader already has a team. Use Edit.' });
    }
    const conflicts = await findConflicts(member_ids);
    if (conflicts.length) {
      return res.status(409).json({ success: false, message: 'Some members are already under another leader' });
    }
    const doc = await KpiLeaderMapping.create({ leader_id, member_ids, permissions });
    await notifyTeam({ leaderId: leader_id, memberIds: member_ids, teamSize: member_ids.length, notifyLeader: true });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/kpi-leader/:id  { member_ids[] }
router.put('/:id', auth, hrOnly, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findById(req.params.id);
    if (!m) return res.status(404).json({ success: false, message: 'Not found' });

    const member_ids = [...new Set(req.body.member_ids || [])].filter(id => id !== String(m.leader_id));
    if (!member_ids.length) {
      return res.status(400).json({ success: false, message: 'At least 1 member required' });
    }
    const conflicts = await findConflicts(member_ids, m._id);
    if (conflicts.length) {
      return res.status(409).json({ success: false, message: 'Some members are already under another leader' });
    }

    const wasLeave = m.permissions?.leave_approval !== false;
    const permissions = req.body.permissions
      ? normPerms(req.body.permissions)
      : { kpi_view: m.permissions?.kpi_view !== false, leave_approval: wasLeave };
    if (!permissions.kpi_view && !permissions.leave_approval) {
      return res.status(400).json({ success: false, message: 'Select at least one access (KPI view / Leave approval)' });
    }

    const oldIds  = m.member_ids.map(String);
    const removed = oldIds.filter(id => !member_ids.includes(id));
    const added   = member_ids.filter(id => !oldIds.includes(id));

    m.member_ids = member_ids;
    m.permissions = permissions;
    await m.save();

    if (wasLeave && !permissions.leave_approval) await forwardPendingToHr(m.leader_id);
    else if (removed.length) await forwardPendingToHr(m.leader_id, removed);

    if (added.length) {
      await notifyTeam({ leaderId: m.leader_id, memberIds: added, teamSize: member_ids.length, notifyLeader: false });
    }

    res.json({ success: true, data: m });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/kpi-leader/:id  (soft remove -> leader access goes immediately)
router.delete('/:id', auth, hrOnly, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findByIdAndUpdate(req.params.id, { isActive: false });
    if (m) await forwardPendingToHr(m.leader_id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;