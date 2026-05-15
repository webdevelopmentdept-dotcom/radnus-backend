// routes/announcements.js — Full with comments + replies + likes

const express      = require('express');
const router       = express.Router();
const Announcement = require('../models/Announcement');
const Employee     = require('../models/Employee');

function canSee(ann, emp) {
  if (ann.target === 'all') return true;
  if (ann.target === 'department') return ann.target_departments.includes(emp.department);
  if (ann.target === 'role')       return ann.target_roles.includes(emp.designation);
  if (ann.target === 'individual') return ann.target_employees.some(id => String(id) === String(emp._id));
  return false;
}

// Helper: get employee info for comment
async function getEmpInfo(id) {
  try {
    const e = await Employee.findById(id).select('name designation profileImage');
    return {
      name:        e?.name        || 'Employee',
      designation: e?.designation || '',
      avatar:      e?.profileImage || ''
    };
  } catch { return { name: 'Employee', designation: '', avatar: '' }; }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/announcements — Create
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const ann = new Announcement({
      ...req.body,
      target_departments: req.body.target_departments || [],
      target_roles:       req.body.target_roles       || [],
      target_employees:   req.body.target_employees   || [],
      images:             req.body.images             || [],
      attachments:        req.body.attachments        || [],
    });
    await ann.save();
    const pop = await Announcement.findById(ann._id).populate('created_by', 'name designation');
    res.status(201).json({ success: true, data: pop });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/announcements/stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [total, active, pinned, urgent, byType] = await Promise.all([
      Announcement.countDocuments(),
      Announcement.countDocuments({ is_active: true }),
      Announcement.countDocuments({ is_pinned: true }),
      Announcement.countDocuments({ type: 'urgent', is_active: true }),
      Announcement.aggregate([{ $group: { _id: '$type', count: { $sum: 1 } } }])
    ]);
    res.json({ success: true, data: { total, active, pinned, urgent, byType } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/announcements/all — HR panel
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all', async (req, res) => {
  try {
    const list = await Announcement.find()
      .populate('created_by', 'name designation')
      .sort({ is_pinned: -1, createdAt: -1 });

    const totalEmp = await Employee.countDocuments({ status: 'active' });

    const data = list.map(a => ({
      ...a.toJSON(),
      read_count:      a.read_by?.length   || 0,
      like_count:      a.likes?.length     || 0,
      comment_count:   a.comments?.length  || 0,
      total_employees: totalEmp,
      read_percentage: totalEmp > 0 ? Math.round(((a.read_by?.length||0)/totalEmp)*100) : 0,
      is_expired:      a.expires_at ? new Date(a.expires_at) < new Date() : false
    }));

    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/announcements/employee/:employeeId — Employee feed
// ─────────────────────────────────────────────────────────────────────────────
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.employeeId);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    const now = new Date();
    const all = await Announcement.find({
      is_active: true,
      $or: [{ expires_at: null }, { expires_at: { $gt: now } }]
    })
      .populate('created_by', 'name designation profileImage')
      .sort({ is_pinned: -1, createdAt: -1 });

    const visible = all.filter(a => canSee(a, emp));

    const data = visible.map(a => {
      const readEntry = a.read_by?.find(r => String(r.employee_id) === String(emp._id));
      const hasLiked  = a.likes?.some(id => String(id) === String(emp._id));

      // Enrich comments with hasLiked for this user
      const comments = (a.comments || []).map(c => ({
        ...c.toObject(),
        has_liked:   c.likes?.some(id => String(id) === String(emp._id)),
        like_count:  c.likes?.length || 0,
        replies: (c.replies || []).map(r => ({
          ...r.toObject(),
          has_liked:  r.likes?.some(id => String(id) === String(emp._id)),
          like_count: r.likes?.length || 0,
        }))
      }));

      return {
        ...a.toJSON(),
        is_read:       !!readEntry,
        read_at:       readEntry?.read_at || null,
        has_liked:     hasLiked,
        read_count:    a.read_by?.length  || 0,
        like_count:    a.likes?.length    || 0,
        comment_count: a.comments?.length || 0,
        comments,
      };
    });

    res.json({ success: true, data, unread_count: data.filter(d => !d.is_read).length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id/read
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/read', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });
    const already = ann.read_by?.some(r => String(r.employee_id) === String(employee_id));
    if (!already) { ann.read_by.push({ employee_id }); await ann.save(); }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id/like — Toggle post like
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/like', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });
    const idx = ann.likes.findIndex(id => String(id) === String(employee_id));
    if (idx >= 0) ann.likes.splice(idx, 1);
    else ann.likes.push(employee_id);
    await ann.save();
    res.json({ success: true, like_count: ann.likes.length, has_liked: idx < 0 });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/announcements/:id/comments — Add comment
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/comments', async (req, res) => {
  try {
    const { employee_id, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Comment text required' });

    const ann  = await Announcement.findById(req.params.id);
    if (!ann)  return res.status(404).json({ success: false });

    const info = await getEmpInfo(employee_id);
    const comment = { employee_id, text: text.trim(), ...info, likes: [], replies: [] };
    ann.comments.push(comment);
    await ann.save();

    const saved = ann.comments[ann.comments.length - 1];
    res.status(201).json({
      success: true,
      data: { ...saved.toObject(), has_liked: false, like_count: 0 },
      comment_count: ann.comments.length
    });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/announcements/:id/comments/:commentId — Delete comment
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });

    const cIdx = ann.comments.findIndex(c => String(c._id) === req.params.commentId);
    if (cIdx < 0) return res.status(404).json({ success: false, message: 'Comment not found' });

    // Only comment owner can delete
    if (String(ann.comments[cIdx].employee_id) !== String(employee_id))
      return res.status(403).json({ success: false, message: 'Not authorized' });

    ann.comments.splice(cIdx, 1);
    await ann.save();
    res.json({ success: true, comment_count: ann.comments.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id/comments/:commentId/like — Toggle comment like
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/comments/:commentId/like', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });

    const comment = ann.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false });

    const idx = comment.likes.findIndex(id => String(id) === String(employee_id));
    if (idx >= 0) comment.likes.splice(idx, 1);
    else comment.likes.push(employee_id);
    await ann.save();

    res.json({ success: true, like_count: comment.likes.length, has_liked: idx < 0 });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/announcements/:id/comments/:commentId/replies — Add reply
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:id/comments/:commentId/replies', async (req, res) => {
  try {
    const { employee_id, text } = req.body;
    if (!text?.trim()) return res.status(400).json({ success: false, message: 'Reply text required' });

    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });

    const comment = ann.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false });

    const info = await getEmpInfo(employee_id);
    const reply = { employee_id, text: text.trim(), ...info, likes: [] };
    comment.replies.push(reply);
    await ann.save();

    const saved = comment.replies[comment.replies.length - 1];
    res.status(201).json({
      success: true,
      data: { ...saved.toObject(), has_liked: false, like_count: 0 }
    });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/announcements/:id/comments/:commentId/replies/:replyId
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id/comments/:commentId/replies/:replyId', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });

    const comment = ann.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false });

    const rIdx = comment.replies.findIndex(r => String(r._id) === req.params.replyId);
    if (rIdx < 0) return res.status(404).json({ success: false });

    if (String(comment.replies[rIdx].employee_id) !== String(employee_id))
      return res.status(403).json({ success: false, message: 'Not authorized' });

    comment.replies.splice(rIdx, 1);
    await ann.save();
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id/comments/:commentId/replies/:replyId/like
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/comments/:commentId/replies/:replyId/like', async (req, res) => {
  try {
    const { employee_id } = req.body;
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });

    const comment = ann.comments.id(req.params.commentId);
    if (!comment) return res.status(404).json({ success: false });

    const reply = comment.replies.id(req.params.replyId);
    if (!reply) return res.status(404).json({ success: false });

    const idx = reply.likes.findIndex(id => String(id) === String(employee_id));
    if (idx >= 0) reply.likes.splice(idx, 1);
    else reply.likes.push(employee_id);
    await ann.save();

    res.json({ success: true, like_count: reply.likes.length, has_liked: idx < 0 });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id — HR edit
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const updated = await Announcement.findByIdAndUpdate(req.params.id, req.body, { new: true })
      .populate('created_by', 'name designation');
    if (!updated) return res.status(404).json({ success: false });
    res.json({ success: true, data: updated });
  } catch (err) { res.status(400).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/announcements/:id/pin
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/pin', async (req, res) => {
  try {
    const ann = await Announcement.findById(req.params.id);
    if (!ann) return res.status(404).json({ success: false });
    ann.is_pinned = !ann.is_pinned;
    await ann.save();
    res.json({ success: true, data: ann });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/announcements/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await Announcement.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;