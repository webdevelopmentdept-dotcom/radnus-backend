// ===== SIMPLE FEEDBACK SYSTEM (standalone — NOT the 360° feedback system) =====
// Employee side: load the active question form, submit feedback, view own
// past submissions + HR reply.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const auth = require('../middleware/auth');
const Employee = require('../models/Employee');
const FeedbackQuestion = require('../models/Feedbackquestion');
const EmployeeFeedback = require('../models/Employeefeedback');

// ── Multer storage — saves attachment to /uploads/feedback/ ──────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../uploads/feedback');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, '-');
    cb(null, `${Date.now()}-${safeName}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max

// GET /api/employee/feedback-questions
// Returns active questions in order, so the employee form can render itself.
router.get('/feedback-questions', auth, async (req, res) => {
  try {
    const questions = await FeedbackQuestion.find({ isActive: true }).sort({ order: 1, createdAt: 1 });
    res.json(questions);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load feedback questions' });
  }
});

// POST /api/employee/feedback
// Body: { anonymous, answers: [{questionId, questionText, type, options, answer, comment}] }
// Attachment (optional): multipart field name "attachment"
router.post('/feedback', auth, upload.single('attachment'), async (req, res) => {
  try {
    const employee = await Employee.findById(req.user.id).lean();
    if (!employee) return res.status(404).json({ message: 'Employee not found' });

    let { anonymous, answers } = req.body;
    if (typeof answers === 'string') answers = JSON.parse(answers); // multipart sends JSON as string
    if (!Array.isArray(answers) || answers.length === 0) {
      return res.status(400).json({ message: 'Answers are required' });
    }

    const isAnonymous = anonymous === true || anonymous === 'true';

    const feedback = await EmployeeFeedback.create({
      employeeId: employee._id,
      employeeName: isAnonymous ? '' : employee.name,
      employeeCode: isAnonymous ? '' : employee.employeeId,
      department: employee.department,
      designation: employee.designation,
      anonymous: isAnonymous,
      answers,
      attachmentUrl: req.file ? `/uploads/feedback/${req.file.filename}` : '',
    });

    res.status(201).json({ message: 'Feedback submitted successfully', feedback });
  } catch (err) {
    console.error('Feedback submit error:', err);
    res.status(500).json({ message: 'Failed to submit feedback' });
  }
});

// GET /api/employee/feedback/my
// Employee's own submissions + HR reply/status
router.get('/feedback/my', auth, async (req, res) => {
  try {
    const list = await EmployeeFeedback.find({ employeeId: req.user.id }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    res.status(500).json({ message: 'Failed to load your feedback' });
  }
});

module.exports = router;