// routes/okrDashboard.js
// GET /api/okr-dashboard  — single call returns everything the Manager OKR Dashboard needs

const express = require('express');
const router  = express.Router();

const KpiAssignment    = require('../models/KpiAssignment');
const KpiActual        = require('../models/KpiActual');
const SelfAssessment   = require('../models/SelfAssessment');
const PerformanceReview = require('../models/PerformanceReview');

// ─── helpers (same logic as your existing calcScore / getRating) ───────────
const calcScore = (items = []) => {
  let total = 0;
  const totalWeight = items.reduce((s, i) => s + (i.weight || 0), 0);
  const eqW = items.length ? 100 / items.length : 0;
  items.forEach(item => {
    const pct = Math.min((item.actual_value / item.target) * 100, 100);
    const w   = totalWeight === 0 ? eqW : (item.weight || 0);
    total += (isNaN(pct) ? 0 : pct) * (w / 100);
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

// ─── GET /api/okr-dashboard ────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // 1. All active assignments with employee + template populated
    const assignments = await KpiAssignment.find({ status: { $in: ['active', 'completed'] } })
      .populate('employee_id', 'name email department designation')
      .populate('template_id', 'template_name role department kpi_items')
      .sort({ createdAt: -1 });

    // 2. All self assessments (indexed by assignment_id for fast lookup)
    const assessments = await SelfAssessment.find()
      .select('employee_id assignment_id items overall_comment status createdAt');
    const assessmentMap = {};
    assessments.forEach(a => { assessmentMap[String(a.assignment_id)] = a; });

    // 3. All finalized reviews (indexed by assignment_id)
    const reviews = await PerformanceReview.find()
      .select('employee_id assignment_id final_score rating kpi_breakdown hr_comment period createdAt');
    const reviewMap = {};
    reviews.forEach(r => { reviewMap[String(r.assignment_id)] = r; });

    // 4. All actuals (indexed by assignment_id)
    const allActuals = await KpiActual.find()
      .select('assignment_id kpi_item_id actual_value');
    const actualsMap = {};
    allActuals.forEach(a => {
      const aid = String(a.assignment_id);
      if (!actualsMap[aid]) actualsMap[aid] = {};
      actualsMap[aid][String(a.kpi_item_id)] = a.actual_value;
    });

    // 5. Build per-employee OKR rows
    const rows = assignments.map(assign => {
      const aid        = String(assign._id);
      const kpiItems   = assign.template_id?.kpi_items || [];
      const actuals    = actualsMap[aid] || {};
      const assessment = assessmentMap[aid] || null;
      const review     = reviewMap[aid]     || null;

      // Build KPI progress items using actuals (HR-entered) or self-assessment values
      const kpiProgress = kpiItems.map(item => {
        const iid         = String(item._id);
        const actualVal   = actuals[iid] ?? null;
        const selfVal     = assessment?.items?.find(i => String(i.kpi_item_id) === iid)?.self_value ?? null;
        const displayVal  = actualVal !== null ? actualVal : selfVal;
        const pct         = displayVal !== null
          ? Math.min(Math.round((displayVal / item.target) * 100), 100)
          : 0;
        return {
          kpi_item_id : iid,
          kpi_name    : item.kpi_name,
          target      : item.target,
          unit        : item.unit,
          weight      : item.weight,
          frequency   : item.frequency,
          actual_value: displayVal,
          self_value  : selfVal,
          pct,
        };
      });

      // OKR score: use finalized review score if exists, else calculate from actuals/self
      const okrScore = review
        ? review.final_score
        : calcScore(kpiProgress.map(k => ({
            actual_value: k.actual_value || 0,
            target      : k.target,
            weight      : k.weight,
          })));

      // Determine OKR status
      let okrStatus = 'not_started';
      if (review)                       okrStatus = 'finalized';
      else if (assessment)              okrStatus = 'self_submitted';
      else if (Object.keys(actuals).length > 0) okrStatus = 'in_progress';
      else if (assign.status === 'active')      okrStatus = 'assigned';

      return {
        assignment_id   : aid,
        assignment_status: assign.status,
        period          : assign.period,
        period_type     : assign.period_type,
        assigned_on     : assign.createdAt,

        employee: {
          id         : assign.employee_id?._id,
          name       : assign.employee_id?.name       || 'Unknown',
          email      : assign.employee_id?.email      || '',
          department : assign.employee_id?.department || '—',
          designation: assign.employee_id?.designation|| '—',
        },

        template: {
          name      : assign.template_id?.template_name || '—',
          role      : assign.template_id?.role          || '—',
          department: assign.template_id?.department    || '—',
        },

        kpi_progress : kpiProgress,
        kpi_count    : kpiItems.length,
        targets_met  : kpiProgress.filter(k => k.pct >= 100).length,

        okr_score  : okrScore,
        okr_rating : getRating(okrScore),
        okr_status : okrStatus,

        self_assessment: assessment ? {
          id          : assessment._id,
          submitted_at: assessment.createdAt,
          comment     : assessment.overall_comment,
        } : null,

        review: review ? {
          id          : review._id,
          final_score : review.final_score,
          rating      : review.rating,
          hr_comment  : review.hr_comment,
          reviewed_at : review.createdAt,
        } : null,
      };
    });

    // 6. Summary stats
    const total       = rows.length;
    const finalized   = rows.filter(r => r.okr_status === 'finalized').length;
    const submitted   = rows.filter(r => r.okr_status === 'self_submitted').length;
    const inProgress  = rows.filter(r => r.okr_status === 'in_progress').length;
    const assigned    = rows.filter(r => r.okr_status === 'assigned').length;

    const scoredRows  = rows.filter(r => r.okr_status === 'finalized');
    const avgScore    = scoredRows.length
      ? Math.round(scoredRows.reduce((s, r) => s + r.okr_score, 0) / scoredRows.length)
      : 0;

    // Department-level summary
    const deptMap = {};
    rows.forEach(r => {
      const d = r.employee.department;
      if (!deptMap[d]) deptMap[d] = { dept: d, count: 0, scores: [] };
      deptMap[d].count++;
      if (r.okr_status === 'finalized') deptMap[d].scores.push(r.okr_score);
    });
    const deptSummary = Object.values(deptMap).map(d => ({
      department: d.dept,
      employee_count: d.count,
      avg_score: d.scores.length
        ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length)
        : null,
    })).sort((a, b) => (b.avg_score || 0) - (a.avg_score || 0));

    res.json({
      success: true,
      summary: { total, finalized, submitted, in_progress: inProgress, assigned, avg_score: avgScore },
      dept_summary: deptSummary,
      data: rows,
    });

  } catch (err) {
    console.error('OKR Dashboard error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;