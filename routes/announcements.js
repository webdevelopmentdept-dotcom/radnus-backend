// routes/announcements.js — FULL VERSION

const express      = require('express');
const router       = express.Router();
const Announcement = require('../models/Announcement');
const Employee     = require('../models/Employee');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — Check if employee can see announcement
// ─────────────────────────────────────────────────────────────────────────────
function canEmployeeSee(announcement, employee) {
  if (announcement.target === 'all') return true;
  if (announcement.target === 'department') {
    return announcement.target_departments.includes(employee.department);
  }
  if (announcement.target === 'role') {
    return announcement.target_roles.includes(employee.designation);
  }
  if (announcement.target === 'individual') {
    return announcement.target_employees.some(
      id => String(id) === String(employee._id)
    );
  }
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/announcements — HR creates announcement
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      title, content, type, priority, target,
      target_departments, target_roles, target_employees,
      created_by, is_pinned, expires_at, attachments, emoji
    } = req.body;

    const announcement = new Announcement({
      title, content, type, priority, target,
      target_departments: target_departments || [],
      target_roles:       target_roles       || [],
      target_employees:   target_employees   || [],
      created_by,
      is_pinned:  is_pinned  || false,
      expires_at: expires_at || null,
      attachments: attachments || [],
      emoji: emoji || ''
    });

    await announcement.save();
    const populated = await Announcement.findById(announcement._id)
      .populate('created_by', 'name designation');
    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/announcements/all — HR: all announcements with stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all', async (req, res) => {
  try {
    const announcements = await Announcement.find()
      .populate('created_by', 'name designation')
      .sort({ is_pinned: -1, createdAt: -1 });

    // Get total employee count for read %
    const totalEmployees = await Employee.countDocuments({ status: 'active' });

    const data = announcements.map(a => ({
      ...a.toJSON(),
      read_count:       a.read_by?.length || 0,
      total_employees:  totalEmployees,
      read_percentage:  totalEmployees > 0
        ? Math.round(((a.read_by?.length || 0) / totalEmployees) * 100)
        : 0,
      is_expired: a.expires_at ? new Date(a.expires_at) < new Date() : false
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/announcements/employee/:employeeId — Employee: their announcements
// ─────────────────────────────────────────────────────────────────────────────
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.employeeId);
    if (!employee) return res.status(404).json({ success: false, message: 'Employee not found' });

    const now = new Date();
    const all = await Announcement.find({
      is_active: true,
      $or: [{ expires_at: null }, { expires_at: { $gt: now } }]
    })
      .populate('created_by', 'name designation')
      .sort({ is_pinned: -1, createdAt: -1 });

    // Filter by target
    const visible = all.filter(a => canEmployeeSee(a, employee));

    // Mark read status
    const data = visible.map(a => {
      const readEntry = a.read_by?.find(
        r => String(r.employee_id) === String(employee._id)
      );
      return {
        ...a.toJSON(),
        is_read:  !!readEntry,
        read_at:  readEntry?.read_at || null,
        read_count: a.read_by?.length || 0
      };
    });

    // Unread count
    const unread_count = data.filter(d => !d.is_read).length;
    res.json({ success: true, data, unread_count });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id/read — Mark as read
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/read', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: 'Not found' });

    const alreadyRead = announcement.read_by?.some(
      r => String(r.employee_id) === String(employee_id)
    );

    if (!alreadyRead) {
      announcement.read_by.push({ employee_id, read_at: new Date() });
      await announcement.save();
    }

    res.json({ success: true, message: 'Marked as read' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id — HR edits announcement
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const updated = await Announcement.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    ).populate('created_by', 'name designation');

    if (!updated) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id/pin — Toggle pin
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/pin', async (req, res) => {
  try {
    const announcement = await Announcement.findById(req.params.id);
    if (!announcement) return res.status(404).json({ success: false, message: 'Not found' });
    announcement.is_pinned = !announcement.is_pinned;
    await announcement.save();
    res.json({ success: true, data: announcement });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/announcements/:id — HR deletes
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/announcements/stats — HR dashboard stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const total      = await Announcement.countDocuments();
    const active     = await Announcement.countDocuments({ is_active: true });
    const pinned     = await Announcement.countDocuments({ is_pinned: true });
    const urgent     = await Announcement.countDocuments({ type: 'urgent', is_active: true });
    const byType     = await Announcement.aggregate([
      { $group: { _id: '$type', count: { $sum: 1 } } }
    ]);
    res.json({ success: true, data: { total, active, pinned, urgent, byType } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;