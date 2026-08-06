// ===== SIMPLE FEEDBACK SYSTEM (standalone — NOT the 360° feedback system) =====


const express = require('express');
const router = express.Router();

const auth = require('../middleware/auth');
const FeedbackQuestion = require('../models/Feedbackquestion');
const EmployeeFeedback = require('../models/Employeefeedback');

/* ══════════════════════════════════════════════════════
   MANAGE FEEDBACK QUESTIONS
   ══════════════════════════════════════════════════════ */

// GET /api/hr/feedback-questions  — all questions (active + inactive)
router.get('/feedback-questions', auth, async (req, res) => {
  try {
    const questions = await FeedbackQuestion.find().sort({ order: 1, createdAt: 1 });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load questions' });
  }
});

// POST /api/hr/feedback-questions  — add a question
// Body: { questionText, type, options, hasComment, commentLabel, required, order }
router.post('/feedback-questions', auth, async (req, res) => {
  try {
    const { questionText, type } = req.body;
    if (!questionText || !type) {
      return res.status(400).json({ message: 'questionText and type are required' });
    }
    if (type === 'single_choice' && (!req.body.options || req.body.options.length < 2)) {
      return res.status(400).json({ message: 'single_choice questions need at least 2 options' });
    }

    const question = await FeedbackQuestion.create(req.body);
    res.status(201).json(question);
  } catch (err) {
    res.status(500).json({ message: 'Failed to create question' });
  }
});

// PUT /api/hr/feedback-questions/:id  — edit a question
router.put('/feedback-questions/:id', auth, async (req, res) => {
  try {
    const question = await FeedbackQuestion.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!question) return res.status(404).json({ message: 'Question not found' });
    res.json(question);
  } catch (err) {
    res.status(500).json({ message: 'Failed to update question' });
  }
});

// DELETE /api/hr/feedback-questions/:id  — delete a question
// NOTE: old submissions keep their own answer snapshot, so deleting a
// question here never breaks past submissions.
router.delete('/feedback-questions/:id', auth, async (req, res) => {
  try {
    const question = await FeedbackQuestion.findByIdAndDelete(req.params.id);
    if (!question) return res.status(404).json({ message: 'Question not found' });
    res.json({ message: 'Question deleted' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to delete question' });
  }
});

/* ══════════════════════════════════════════════════════
   REVIEW EMPLOYEE SUBMISSIONS
   ══════════════════════════════════════════════════════ */

// GET /api/hr/feedback-submissions  — list all (optional ?status=Pending)
router.get('/feedback-submissions', auth, async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const list = await EmployeeFeedback.find(filter).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load feedback submissions' });
  }
});

// GET /api/hr/feedback-submissions/:id  — full detail
router.get('/feedback-submissions/:id', auth, async (req, res) => {
  try {
    const feedback = await EmployeeFeedback.findById(req.params.id);
    if (!feedback) return res.status(404).json({ message: 'Feedback not found' });
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load feedback' });
  }
});

// PUT /api/hr/feedback-submissions/:id/reply  — HR reply note + mark Reviewed
// Body: { hrReply }
router.put('/feedback-submissions/:id/reply', auth, async (req, res) => {
  try {
    const { hrReply } = req.body;
    const feedback = await EmployeeFeedback.findByIdAndUpdate(
      req.params.id,
      { hrReply, status: 'Reviewed', reviewedAt: new Date() },
      { new: true }
    );
    if (!feedback) return res.status(404).json({ message: 'Feedback not found' });
    res.json(feedback);
  } catch (err) {
    res.status(500).json({ message: 'Failed to save reply' });
  }
});

module.exports = router;