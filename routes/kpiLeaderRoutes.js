const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const KpiLeaderMapping = require('../models/KpiLeaderMapping');
const KpiAssignment = require('../models/KpiAssignment');
const Employee = require('../models/Employee');

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

/* ───────────── LEADER SIDE (employee token) ───────────── */

// GET /api/kpi-leader/me  -> sidebar: show "My Team KPI" menu?
router.get('/me', auth, async (req, res) => {
  try {
    const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true });
    res.json({ success: true, isLeader: !!m, teamSize: m ? m.member_ids.length : 0 });
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
    if (!leader_id || !member_ids.length) {
      return res.status(400).json({ success: false, message: 'Leader and at least 1 member required' });
    }
    if (await KpiLeaderMapping.findOne({ leader_id, isActive: true })) {
      return res.status(409).json({ success: false, message: 'This leader already has a team. Use Edit.' });
    }
    const conflicts = await findConflicts(member_ids);
    if (conflicts.length) {
      return res.status(409).json({ success: false, message: 'Some members are already under another leader' });
    }
    const doc = await KpiLeaderMapping.create({ leader_id, member_ids });
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
    m.member_ids = member_ids;
    await m.save();
    res.json({ success: true, data: m });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/kpi-leader/:id  (soft remove -> leader access goes immediately)
router.delete('/:id', auth, hrOnly, async (req, res) => {
  try {
    await KpiLeaderMapping.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;