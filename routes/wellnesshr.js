// routes/wellnessRoutes.js — FULL VERSION

const express        = require('express');
const router         = express.Router();
const WellnessSession = require('../models/Wellness');

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/wellness — Employee books a session
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { employee_id, session_type, title, description, scheduled_date, scheduled_time, mode, employee_notes } = req.body;
    const session = new WellnessSession({
      employee_id, session_type, title, description,
      scheduled_date, scheduled_time, mode, employee_notes
    });
    await session.save();
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wellness/all — All sessions (HR panel)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all', async (req, res) => {
  try {
    const sessions = await WellnessSession.find()
      .populate('employee_id', 'name email department designation')
      .populate('reviewed_by', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wellness/stats — HR dashboard stats
// ─────────────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [total, requested, approved, completed, cancelled] = await Promise.all([
      WellnessSession.countDocuments(),
      WellnessSession.countDocuments({ status: 'requested' }),
      WellnessSession.countDocuments({ status: 'approved' }),
      WellnessSession.countDocuments({ status: 'completed' }),
      WellnessSession.countDocuments({ status: 'cancelled' }),
    ]);

    // Avg feedback score
    const feedbackDocs = await WellnessSession.find({ feedback_score: { $exists: true } });
    const avgFeedback = feedbackDocs.length
      ? (feedbackDocs.reduce((s, d) => s + d.feedback_score, 0) / feedbackDocs.length).toFixed(1)
      : null;

    // By session type
    const byType = await WellnessSession.aggregate([
      { $group: { _id: '$session_type', count: { $sum: 1 } } }
    ]);

    res.json({ success: true, data: { total, requested, approved, completed, cancelled, avgFeedback, byType } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/wellness/employee/:employeeId — Employee's own sessions
// ─────────────────────────────────────────────────────────────────────────────
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const sessions = await WellnessSession.find({ employee_id: req.params.employeeId })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/wellness/:id/status — HR approves / rejects / completes
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/status', async (req, res) => {
  try {
    const { status, hr_notes, reviewed_by } = req.body;
    const session = await WellnessSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    session.status      = status;
    session.hr_notes    = hr_notes || session.hr_notes;
    session.reviewed_by = reviewed_by || session.reviewed_by;
    await session.save();

    res.json({ success: true, data: session });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/wellness/:id/feedback — Employee submits feedback after session
// ─────────────────────────────────────────────────────────────────────────────
router.put('/:id/feedback', async (req, res) => {
  try {
    const { feedback_score, feedback_comment } = req.body;
    const session = await WellnessSession.findById(req.params.id);
    if (!session) return res.status(404).json({ success: false, message: 'Session not found' });

    session.feedback_score   = feedback_score;
    session.feedback_comment = feedback_comment;
    await session.save();

    res.json({ success: true, data: session });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/wellness/:id — Employee cancels (or HR deletes)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await WellnessSession.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;