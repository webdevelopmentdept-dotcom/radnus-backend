// performanceReviewRoutes.js — FULL UPDATED VERSION

const express = require('express');
const router = express.Router();
const PerformanceReview = require('../models/PerformanceReview');
const KpiAssignment = require('../models/KpiAssignment');
const { createNotification } = require('../helpers/notificationHelper');
const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const EmploymentDetails = require('../models/EmploymentDetails');
const { periodToAbs, buildCycles, MIN_PER_MONTH, CYCLE_LEN, CYCLE_REQUIRED } = require('../helpers/kpiCycleLogic');

// ✅ FIX: Model already loaded-ஆ இருந்தா reuse பண்ணு — OverwriteModelError இல்லை
const SelfAssessment = mongoose.models.SelfAssessment ||
  require('../models/SelfAssessment'); 



const calcScore = (items) => {
  if (!items || items.length === 0) return 0;
  
  const totalWeight = items.reduce((s, item) => s + (Number(item.weight) || 0), 0);
  let total = 0;
  
  items.forEach((item, idx) => {
    // ✅ Force explicit number conversion — no string fallback
    const actualVal = Number(item.actual_value);
    const targetVal = Number(item.target) || 1;
    
    // ✅ Debug log to verify values in server console
    console.log(`[calcScore] KPI ${idx}: actual_value raw="${item.actual_value}" parsed=${actualVal}, target=${targetVal}`);
    
    const pct = targetVal ? Math.min((actualVal / targetVal) * 100, 100) : 0;
    const weight = totalWeight === 0 ? (100 / items.length) : (Number(item.weight) || 0);
    const divisor = totalWeight === 0 ? 100 : totalWeight;
    
    total += pct * (weight / divisor);
  });
  
  const finalScore = Math.round(total);
  console.log(`[calcScore] Final Score: ${finalScore}%`);
  return finalScore;
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/performance-reviews/kpi-compliance            (optional: ?asOf=2026-09)
//
// Employee-wise 3-month KPI CYCLES (not calendar quarters). See
// helpers/kpiCycleLogic.js for the full rules. In short:
//   • Cycle 1 starts in the employee's first KPI month (earliest KpiAssignment.period
//     or finalized review month).
//   • KPI applies from the 2nd month after joining (anchor >= joining month + 1).
//   • Each cycle = 3 months, needs a combined total >= 150% (50% x 3).
//   • When the 3rd month is reviewed the cycle closes (status final) and the
//     next cycle starts the following month.
//
// Response: one row per active employee with ALL of their cycles up to the
// current one, so the UI can show current / previous / cycle N.
//
// Must be declared BEFORE router.get('/:employeeId') or it will be shadowed.
// ─────────────────────────────────────────────────────────────────────────────

// date_of_joining is stored as a string (normally "YYYY-MM-DD")
const parseJoinDate = (val) => {
  if (!val) return null;
  const m = String(val).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return { y: +m[1], m: +m[2] - 1, d: +m[3] };
  const dt = new Date(val);
  if (isNaN(dt)) return null;
  return { y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() };
};

router.get('/kpi-compliance', async (req, res) => {
  try {
    // "today" as an absolute month number; ?asOf=YYYY-MM lets you simulate another month
    const now = new Date();
    let refAbs = now.getFullYear() * 12 + now.getMonth();
    const asOf = String(req.query.asOf || '').match(/^(\d{4})-(\d{1,2})$/);
    if (asOf && +asOf[2] >= 1 && +asOf[2] <= 12) refAbs = +asOf[1] * 12 + (+asOf[2] - 1);

    const employees = await Employee.find({ status: 'active' })
      .select('name employeeId department designation createdAt')
      .lean();
    const ids = employees.map(e => e._id);

    const [detailsList, reviews, assignments] = await Promise.all([
      EmploymentDetails.find({ employee_id: { $in: ids } })
        .select('employee_id employment.date_of_joining').lean(),
      // ALL finalized reviews (scores)
      PerformanceReview.find({ employee_id: { $in: ids }, status: 'finalized' })
        .select('employee_id period final_score').lean(),
      // months a KPI was assigned — the earliest one decides where the cycle starts
      KpiAssignment.find({ employee_id: { $in: ids }, status: { $ne: 'cancelled' } })
        .select('employee_id period').lean(),
    ]);

    // employeeId -> [absMonth]   (period_type quarterly/annual like "Q1 2026" is ignored)
    const assignedMap = new Map();
    assignments.forEach(a => {
      const abs = periodToAbs(a.period);
      if (abs === null) return;
      const k = String(a.employee_id);
      if (!assignedMap.has(k)) assignedMap.set(k, []);
      assignedMap.get(k).push(abs);
    });

    const joinByEmp = new Map(detailsList.map(d => [String(d.employee_id), d.employment?.date_of_joining]));

    // employeeId -> Map(absMonth -> [scores])
    const scoreMap = new Map();
    reviews.forEach(r => {
      if (typeof r.final_score !== 'number') return;
      const abs = periodToAbs(r.period);
      if (abs === null) return;
      const k = String(r.employee_id);
      if (!scoreMap.has(k)) scoreMap.set(k, new Map());
      const byMonth = scoreMap.get(k);
      if (!byMonth.has(abs)) byMonth.set(abs, []);
      byMonth.get(abs).push(r.final_score);
    });

    const rows = employees.map(emp => {
      const key = String(emp._id);
      const jd = parseJoinDate(joinByEmp.get(key)) ||
        (emp.createdAt ? { y: emp.createdAt.getFullYear(), m: emp.createdAt.getMonth(), d: emp.createdAt.getDate() } : null);
      const joinAbs = jd ? jd.y * 12 + jd.m : null;

      const { state, currentIndex, cycles } = buildCycles(scoreMap.get(key) || new Map(), joinAbs, refAbs, assignedMap.get(key) || []);

      return {
        _id: emp._id,
        employeeId: emp.employeeId || '',
        name: emp.name || '—',
        department: emp.department || '—',
        designation: emp.designation || '—',
        joined_on: jd ? `${jd.y}-${String(jd.m + 1).padStart(2, '0')}-${String(jd.d).padStart(2, '0')}` : null,
        state,                       // 'active' | 'exempt' (joining month) | 'not_started' (no KPI yet)
        current_index: currentIndex, // index into cycles[] of the running cycle (-1 if none)
        cycles,
      };
    }).sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      success: true,
      as_of: `${Math.floor(refAbs / 12)}-${String((refAbs % 12) + 1).padStart(2, '0')}`,
      rules: { min_per_month: MIN_PER_MONTH, cycle_months: CYCLE_LEN, cycle_required: CYCLE_REQUIRED },
      data: rows,
    });
  } catch (err) {
    console.error('❌ GET /performance-reviews/kpi-compliance error:', err.message);
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