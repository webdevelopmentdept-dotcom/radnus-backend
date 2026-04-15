// routes/selfAssessment.js — FULL UPDATED VERSION

const express        = require('express');
const router         = express.Router();
const SelfAssessment = require('../models/SelfAssessment');
const KpiAssignment  = require('../models/KpiAssignment');
const OkrObjective   = require('../models/OkrObjective');

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — score calculate
// ─────────────────────────────────────────────────────────────────────────────
function calcSelfScore(items) {
  if (!items || !items.length) return 0;
  const totalWeight = items.reduce((s, i) => s + (i.weight || 0), 0);
  let score = 0;
  items.forEach(item => {
    const pct = Math.min((parseFloat(item.self_value) / item.target) * 100, 100);
    const w = totalWeight === 0 ? (100 / items.length) : (item.weight || 0);
    score += (isNaN(pct) ? 0 : pct) * (w / 100);
  });
  return Math.round(score);
}

function getRatingLabel(score) {
  if (score >= 90) return 'Outstanding';
  if (score >= 75) return 'Exceeds Expectations';
  if (score >= 60) return 'Meets Expectations';
  if (score >= 45) return 'Needs Improvement';
  return 'Unsatisfactory';
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — Auto-update OKR Key Results
// ─────────────────────────────────────────────────────────────────────────────
async function updateOkrProgress(assignment_id, items) {
  try {
    const assignment = await KpiAssignment.findById(assignment_id)
      .populate('employee_id', 'department')
      .populate('template_id', 'kpi_items');

    if (!assignment) return;
    const dept = assignment.employee_id?.department;
    if (!dept) return;

    const okrs = await OkrObjective.find({ department: dept, status: 'active' });
    if (!okrs.length) return;

    for (const okr of okrs) {
      let updated = false;
      for (const item of items) {
        const kr = okr.key_results.find(k =>
          String(k.linked_kpi_item_id) === String(item.kpi_item_id)
        );
        if (kr) {
          kr.current_value = parseFloat(item.self_value) || 0;
          updated = true;
        }
      }
      if (updated) await okr.save();
    }
  } catch (err) {
    console.error('OKR auto-update error:', err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/self-assessment — Employee submits
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { employee_id, assignment_id, period, items, overall_comment } = req.body;
    const existing = await SelfAssessment.findOne({ employee_id, assignment_id });

    if (existing) {
      existing.items           = items;
      existing.overall_comment = overall_comment;
      existing.status          = 'submitted';
      await existing.save();
      await updateOkrProgress(assignment_id, items);
      return res.json({ success: true, data: existing, updated: true });
    }

    const assessment = new SelfAssessment({ employee_id, assignment_id, period, items, overall_comment });
    await assessment.save();
    await updateOkrProgress(assignment_id, items);
    res.status(201).json({ success: true, data: assessment });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/self-assessment/all — All assessments (HR panel)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/all', async (req, res) => {
  try {
    const assessments = await SelfAssessment.find()
      .populate('employee_id', 'name email department designation')
      .populate('assignment_id')
      .populate('reviewed_by', 'name')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: assessments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/self-assessment/performance-reviews/all
// HR Reports page — reviewed assessments in transformed format
// ─────────────────────────────────────────────────────────────────────────────
router.get('/performance-reviews/all', async (req, res) => {
  try {
    const assessments = await SelfAssessment.find({ status: 'reviewed' })
      .populate('employee_id', 'name email department designation')
      .populate('assignment_id')
      .populate('reviewed_by', 'name')
      .sort({ reviewed_at: -1 });

    const data = assessments.map(a => {
      const selfScore  = calcSelfScore(a.items);
      const finalScore = a.hr_final_score || selfScore;

      return {
        _id:          a._id,
        employee_id:  a.employee_id,
        period:       a.period,
        status:       a.status,
        createdAt:    a.reviewed_at || a.createdAt,
        reviewed_at:  a.reviewed_at,
        reviewed_by:  a.reviewed_by,
        final_score:  finalScore,
        self_score:   selfScore,
        rating:       a.hr_rating || getRatingLabel(finalScore),
        hr_comment:   a.hr_overall_comment || '',
        kpi_breakdown: (a.items || []).map(item => ({
          kpi_name:     item.kpi_name,
          target:       item.target,
          unit:         item.unit,
          weight:       item.weight || 0,
          self_value:   item.self_value,
          actual_value: item.hr_value ?? item.self_value,
          hr_comment:   item.hr_comment || ''
        }))
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/self-assessment/by-assignment/:assignmentId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/by-assignment/:assignmentId', async (req, res) => {
  try {
    const assessment = await SelfAssessment.findOne({ assignment_id: req.params.assignmentId })
      .populate('employee_id', 'name email department designation')
      .populate('reviewed_by', 'name');
    res.json({ success: true, data: assessment || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/self-assessment/completed/:employeeId
// Employee Completed tab — ⚠️ Must be BEFORE /:employeeId
// ─────────────────────────────────────────────────────────────────────────────
router.get('/completed/:employeeId', async (req, res) => {
  try {
    const assessments = await SelfAssessment.find({
      employee_id: req.params.employeeId,
      status: 'reviewed'
    })
      .populate('assignment_id')
      .populate('reviewed_by', 'name')
      .sort({ reviewed_at: -1 });

    const data = assessments.map(a => {
      const selfScore  = calcSelfScore(a.items);
      const finalScore = a.hr_final_score || selfScore;
      return {
        ...a.toObject(),
        self_score:       selfScore,
        final_score:      finalScore,
        reviewed_by_name: a.reviewed_by?.name || 'HR Team',
        department:       a.assignment_id?.department || '',
        role:             a.assignment_id?.role || '',
        submitted_at:     a.updatedAt
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/self-assessment/:employeeId — Employee's own assessments
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:employeeId', async (req, res) => {
  try {
    const assessments = await SelfAssessment.find({ employee_id: req.params.employeeId })
      .populate('assignment_id')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: assessments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/self-assessment/review/:id — HR finalizes review
// ─────────────────────────────────────────────────────────────────────────────
router.put('/review/:id', async (req, res) => {
  try {
    const { hr_final_score, hr_rating, hr_overall_comment, reviewed_by, items } = req.body;

    const assessment = await SelfAssessment.findById(req.params.id);
    if (!assessment) return res.status(404).json({ success: false, message: 'Assessment not found' });

    assessment.hr_final_score     = hr_final_score;
    assessment.hr_rating          = hr_rating;
    assessment.hr_overall_comment = hr_overall_comment;
    assessment.reviewed_by        = reviewed_by;
    assessment.reviewed_at        = new Date();
    assessment.status             = 'reviewed';

    if (items && items.length) {
      items.forEach(hrItem => {
        const found = assessment.items.find(i => String(i.kpi_item_id) === String(hrItem.kpi_item_id));
        if (found) {
          found.hr_value   = hrItem.hr_value;
          found.hr_comment = hrItem.hr_comment;
        }
      });
    }

    await assessment.save();
    res.json({ success: true, data: assessment });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;