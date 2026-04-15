// performanceReviewRoutes.js — FULL UPDATED VERSION

const express = require('express');
const router = express.Router();
const PerformanceReview = require('../models/PerformanceReview');
const KpiAssignment = require('../models/KpiAssignment');
const { createNotification } = require('../helpers/notificationHelper');
const mongoose = require('mongoose');

// ✅ FIX: Model already loaded-ஆ இருந்தா reuse பண்ணு — OverwriteModelError இல்லை
const SelfAssessment = mongoose.models.SelfAssessment ||
  require('../models/SelfAssessment'); 

const calcScore = (items) => {
  if (!items || items.length === 0) return 0;
  const totalWeight = items.reduce((s, item) => s + (item.weight || 0), 0);
  let total = 0;
  items.forEach(item => {
    const pct     = item.target ? Math.min((item.actual_value / item.target) * 100, 100) : 0;
    const weight  = totalWeight === 0 ? (100 / items.length) : (item.weight || 0);
    const divisor = totalWeight === 0 ? 100 : totalWeight;
    total += pct * (weight / divisor);
  });
  return Math.round(total);
};

const getRating = (score) => {
  if (score >= 90) return 'Outstanding';
  if (score >= 75) return 'Exceeds Expectations';
  if (score >= 60) return 'Meets Expectations';
  if (score >= 45) return 'Needs Improvement';
  return 'Unsatisfactory';
};

router.post('/', async (req, res) => {
  try {
    const {
      employee_id, assignment_id, self_assessment_id,
      period, kpi_breakdown, hr_comment, reviewed_by
    } = req.body;

    if (!employee_id || !assignment_id || !period) {
      return res.status(400).json({ success: false, message: 'employee_id, assignment_id and period are required.' });
    }
    if (!Array.isArray(kpi_breakdown) || kpi_breakdown.length === 0) {
      return res.status(400).json({ success: false, message: 'kpi_breakdown must be a non-empty array.' });
    }

    const final_score = calcScore(kpi_breakdown);
    const rating      = getRating(final_score);

    const existing = await PerformanceReview.findOne({ employee_id, assignment_id });

    if (existing) {
      existing.kpi_breakdown = kpi_breakdown;
      existing.hr_comment    = hr_comment;
      existing.final_score   = final_score;
      existing.rating        = rating;
      existing.period        = period;
      existing.reviewed_by   = reviewed_by;
      existing.status        = 'finalized';
      await existing.save();

      // ✅ FIX: hr_overall_comment also saved to SelfAssessment (update case)
      if (self_assessment_id) {
        await SelfAssessment.findByIdAndUpdate(
          self_assessment_id,
          { 
            status: 'reviewed', 
            final_score: final_score, 
            reviewed_at: new Date(),
            hr_overall_comment: hr_comment  // ✅ HR comment now saved!
          }
        );
      }

      await createNotification({
        recipient_id:   employee_id,
        recipient_role: 'employee',
        type:           'hr',
        title:          'Performance Review Updated ⭐',
        message:        `Your review for ${period} has been updated. Final score: ${final_score}% (${rating}).`,
        link:           '/employee/performance'
      });

      return res.json({ success: true, data: existing, updated: true });
    }

    const review = new PerformanceReview({
      employee_id, assignment_id, self_assessment_id,
      period, kpi_breakdown, hr_comment,
      final_score, rating, reviewed_by, status: 'finalized'
    });
    await review.save();

    // ✅ FIX: hr_overall_comment also saved to SelfAssessment (new case)
    if (self_assessment_id) {
      await SelfAssessment.findByIdAndUpdate(
        self_assessment_id,
        { 
          status: 'reviewed', 
          final_score: final_score, 
          reviewed_at: new Date(),
          hr_overall_comment: hr_comment  // ✅ HR comment now saved!
        }
      );
    }

    await KpiAssignment.findByIdAndUpdate(assignment_id, { status: 'completed' });

    await createNotification({
      recipient_id:   employee_id,
      recipient_role: 'employee',
      type:           'hr',
      title:          'Performance Review Done ⭐',
      message:        `Your review for ${period} is complete. Final score: ${final_score}% (${rating}).`,
      link:           '/employee/performance'
    });

    res.status(201).json({ success: true, data: review });

  } catch (err) {
    console.error('❌ POST /performance-reviews error:', err.message);
    res.status(400).json({ success: false, message: err.message });
  }
});

router.get('/all', async (req, res) => {
  try {
    const reviews = await PerformanceReview.find()
      .populate('employee_id', 'name email department designation')
      .populate('assignment_id')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: reviews });
  } catch (err) {
    console.error('❌ GET /performance-reviews/all error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get('/:employeeId', async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.employeeId)) {
      return res.status(400).json({ success: false, message: 'Invalid employeeId.' });
    }
    const employeeId = new mongoose.Types.ObjectId(req.params.employeeId);
    const reviews = await PerformanceReview.find({ employee_id: employeeId })
      .populate('assignment_id')
      .sort({ createdAt: -1 });
    // console.log(`✅ Reviews for ${req.params.employeeId}:`, reviews.length);
    res.json({ success: true, data: reviews });
  } catch (err) {
    console.error('❌ GET /performance-reviews/:employeeId error:', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ GET /api/performance-reviews — Dashboard total count
router.get("/", async (req, res) => {
  try {
    const reviews = await PerformanceReview.find();
    res.json({ success: true, total: reviews.length, data: reviews });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;