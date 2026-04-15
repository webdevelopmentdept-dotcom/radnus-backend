const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const FeedbackSubmission = require('../models/FeedbackSubmission');
const FeedbackNomination = require('../models/Feedbacknomination');
const FeedbackCycle = require('../models/Feedbackcycle');
const FeedbackTask = require("../models/FeedbackTask");

const calcOverallScore = (competencies = {}) => {
  const keys = ['communication', 'leadership', 'technicalSkills', 'goalAchievement', 'innovation', 'teamwork'];
  const vals = keys.map(k => competencies[k]).filter(v => typeof v === 'number' && v > 0);
  if (!vals.length) return 0;
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
};

const getWeight = (type, w = {}) => {
  if (type === 'manager')     return w.manager     ?? 40;
  if (type === 'peer')        return w.peers        ?? 25;
  if (type === 'subordinate') return w.subordinates ?? 20;
  if (type === 'self')        return w.self         ?? 15;
  return 25;
};

// ─────────────────────────────────────────
// GET /api/feedback-submissions/my-pending/:reviewerId
// ✅ FIX: mongoose.Types.ObjectId — string vs ObjectId mismatch fix
// ─────────────────────────────────────────
router.get('/my-pending/:reviewerId', async (req, res) => {
  try {
    const { reviewerId } = req.params;

    // ✅ Convert string → ObjectId to avoid MongoDB mismatch
    let reviewerObjId;
    try {
      reviewerObjId = new mongoose.Types.ObjectId(reviewerId);
    } catch {
      return res.json({ success: true, data: [] });
    }

    const tasks = await FeedbackTask.find({
      reviewerId: reviewerObjId,  // ✅ ObjectId query
      status: "PENDING"
    })
      .populate("revieweeId", "name department designation")
      .populate("cycleId",    "cycleName period");

    // ✅ Filter nulls — deleted cycle or employee
    const validTasks = tasks.filter(t => t.cycleId && t.revieweeId);

    res.json({
      success: true,
      data: validTasks.map(t => ({
        cycleId:             t.cycleId._id,
        cycleName:           t.cycleId.cycleName,
        period:              t.cycleId.period,
        revieweeId:          t.revieweeId._id,
        revieweeName:        t.revieweeId.name,
        revieweeDept:        t.revieweeId.department,
        revieweeDesignation: t.revieweeId.designation,
        reviewerType:        t.reviewerType,
      }))
    });

  } catch (err) {
    console.error('my-pending error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/feedback-submissions/my-submitted/:reviewerId
// ─────────────────────────────────────────
router.get('/my-submitted/:reviewerId', async (req, res) => {
  try {
    let reviewerObjId;
    try {
      reviewerObjId = new mongoose.Types.ObjectId(req.params.reviewerId);
    } catch {
      return res.json({ success: true, data: [] });
    }

    const submissions = await FeedbackSubmission.find({
      reviewerId:  reviewerObjId,
      isSubmitted: true,
    })
      .populate('cycleId',    'cycleName period')
      .populate('revieweeId', 'name department designation')
      .sort({ submittedAt: -1 });

    res.json({ success: true, data: submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/feedback-submissions/summary/:cycleId
// ─────────────────────────────────────────
router.get('/summary/:cycleId', async (req, res) => {
  try {
    const { cycleId } = req.params;

    const cycle = await FeedbackCycle.findById(cycleId)
      .populate('selectedEmployees', 'name department designation');
    if (!cycle) return res.status(404).json({ success: false, message: 'Cycle not found' });

    const nominations = await FeedbackNomination.find({ cycleId })
      .populate('employeeId', 'name department designation');

    const submissions = await FeedbackSubmission.find({
      cycleId,
      isSubmitted: true,
    })
      .populate('reviewerId',  'name department')
      .populate('revieweeId',  'name department designation');

    const w = cycle.weightage || {};

    const revieweeMap = {};
    for (const sub of submissions) {
      const rid = String(sub.revieweeId?._id || sub.revieweeId);
      if (!revieweeMap[rid]) revieweeMap[rid] = [];
      revieweeMap[rid].push(sub);
    }

    const nominatedEmpIds = new Set(nominations.map(n => String(n.employeeId?._id)));
    const extraEmployees  = (cycle.selectedEmployees || []).filter(
      emp => !nominatedEmpIds.has(String(emp._id))
    );

    const config = cycle.reviewerConfig || {};

    const nominatedSummary = nominations.map(nom => {
      const empId   = String(nom.employeeId?._id);
      const empSubs = revieweeMap[empId] || [];

      const expectedReviews =
        (config.manager      ? 1 : 0) +
        (config.peers        ? (cycle.peerCount || 2) : 0) +
        (config.subordinates ? (nom.subordinateIds?.length || 0) : 0) +
        (config.self         ? 1 : 0);

      let aggregatedScore = 0;
      if (empSubs.length > 0) {
        let ws = 0, tw = 0;
        for (const s of empSubs) {
          const wt = getWeight(s.reviewerType, w);
          ws += (s.overallScore || 0) * wt;
          tw += wt;
        }
        aggregatedScore = tw > 0 ? Math.round(ws / tw) : 0;
      }

      return {
        employeeId:      empId,
        employeeName:    nom.employeeId?.name,
        department:      nom.employeeId?.department,
        designation:     nom.employeeId?.designation,
        expectedReviews: expectedReviews || (1 + (cycle.peerCount || 2)),
        receivedReviews: empSubs.length,
        allSubmitted:    empSubs.length >= (expectedReviews || 1),
        aggregatedScore,
        submissions: empSubs.map(s => ({
          reviewerName: s.reviewerId?.name || 'Anonymous',
          reviewer:     s.reviewerId?.name || 'Anonymous',
          reviewerType: s.reviewerType,
          overallScore: s.overallScore,
        })),
      };
    });

    const extraSummary = extraEmployees.map(emp => {
      const empId   = String(emp._id);
      const empSubs = revieweeMap[empId] || [];
      const expectedReviews =
        (config.manager ? 1 : 0) +
        (config.peers   ? (cycle.peerCount || 2) : 0) +
        (config.self    ? 1 : 0);

      let aggregatedScore = 0;
      if (empSubs.length > 0) {
        let ws = 0, tw = 0;
        for (const s of empSubs) {
          const wt = getWeight(s.reviewerType, w);
          ws += (s.overallScore || 0) * wt;
          tw += wt;
        }
        aggregatedScore = tw > 0 ? Math.round(ws / tw) : 0;
      }

      return {
        employeeId:      empId,
        employeeName:    emp.name,
        department:      emp.department,
        designation:     emp.designation,
        expectedReviews: expectedReviews || 3,
        receivedReviews: empSubs.length,
        allSubmitted:    false,
        aggregatedScore,
        nominations:     'pending',
        submissions: empSubs.map(s => ({
          reviewerName: s.reviewerId?.name || 'Anonymous',
          reviewer:     s.reviewerId?.name || 'Anonymous',
          reviewerType: s.reviewerType,
          overallScore: s.overallScore,
        })),
      };
    });

    res.json({ success: true, data: [...nominatedSummary, ...extraSummary] });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/feedback-submissions/aggregated/:cycleId/:employeeId
// ─────────────────────────────────────────
router.get('/aggregated/:cycleId/:employeeId', async (req, res) => {
  try {
    const { cycleId, employeeId } = req.params;

    const cycle = await FeedbackCycle.findById(cycleId);
    if (!cycle) return res.status(404).json({ success: false, message: 'Cycle not found' });

    const submissions = await FeedbackSubmission.find({
      cycleId,
      revieweeId:  employeeId,
      isSubmitted: true,
    });

    if (!submissions.length)
      return res.json({ success: true, data: null, message: 'No submissions yet' });

    const w = cycle.weightage || {};
    let weightedSum = 0, totalWeight = 0;
    for (const sub of submissions) {
      const weight = getWeight(sub.reviewerType, w);
      weightedSum += (sub.overallScore || 0) * weight;
      totalWeight += weight;
    }
    const aggregatedScore = totalWeight > 0 ? Math.round(weightedSum / totalWeight) : 0;

    const keys = ['communication', 'leadership', 'technicalSkills', 'goalAchievement', 'innovation', 'teamwork'];
    const aggregatedCompetencies = {};
    keys.forEach(k => {
      const vals = submissions.map(s => s.competencies?.[k]).filter(v => typeof v === 'number' && v > 0);
      aggregatedCompetencies[k] = vals.length > 0
        ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0;
    });

    res.json({
      success: true,
      data: {
        employeeId, cycleId, aggregatedScore,
        aggregatedCompetencies,
        submissionCount: submissions.length,
        breakdown: submissions.map(s => ({
          reviewerType: s.reviewerType,
          overallScore: s.overallScore,
        })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/feedback-submissions/cycle/:cycleId
// ─────────────────────────────────────────
router.get('/cycle/:cycleId', async (req, res) => {
  try {
    const submissions = await FeedbackSubmission.find({
      cycleId:     req.params.cycleId,
      isSubmitted: true,
    })
      .populate('reviewerId',  'name department')
      .populate('revieweeId',  'name department designation');

    res.json({ success: true, data: submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────
// POST /api/feedback-submissions
// ✅ FIX: reviewerId required check + reviewerType included in findOne
// ─────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const {
      cycleId, revieweeId, reviewerId, reviewerType,
      competencies, strengths, areasForImprovement, additionalComments,
    } = req.body;

    if (!cycleId || !revieweeId || !reviewerId || !reviewerType) {
      return res.status(400).json({
        success: false,
        message: `Missing: ${[
          !cycleId     && 'cycleId',
          !revieweeId  && 'revieweeId',
          !reviewerId  && 'reviewerId',
          !reviewerType && 'reviewerType',
        ].filter(Boolean).join(', ')}`
      });
    }

    const overallScore = calcOverallScore(competencies);

    // ✅ reviewerId + reviewerType both — prevents self overwriting peer record
    let submission = await FeedbackSubmission.findOne({
      cycleId,
      revieweeId,
      reviewerId,
      reviewerType,
    });

    if (submission) {
      submission.competencies        = competencies || submission.competencies;
      submission.overallScore        = overallScore;
      submission.strengths           = strengths           || '';
      submission.areasForImprovement = areasForImprovement || '';
      submission.additionalComments  = additionalComments  || '';
      submission.isSubmitted         = true;
      submission.submittedAt         = new Date();
      await submission.save();
    } else {
      submission = new FeedbackSubmission({
        cycleId, revieweeId, reviewerId, reviewerType,
        competencies:        competencies || {},
        overallScore,
        strengths:           strengths           || '',
        areasForImprovement: areasForImprovement || '',
        additionalComments:  additionalComments  || '',
        isSubmitted:         true,
        submittedAt:         new Date(),
      });
      await submission.save();
    }

    // ✅ Mark task COMPLETED — reviewerType include பண்ணு
    await FeedbackTask.findOneAndUpdate(
      { cycleId, reviewerId, revieweeId, reviewerType },
      { status: "COMPLETED" }
    );

    res.status(201).json({ success: true, data: submission });
  } catch (err) {
    console.error('Submission error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ GET /api/feedback-submissions — Dashboard total count
router.get("/", async (req, res) => {
  try {
    const submissions = await FeedbackSubmission.find({ isSubmitted: true });
    const pending = await FeedbackSubmission.find({ isSubmitted: false });
    res.json({ 
      success: true, 
      total: submissions.length,
      pending: pending.length,
      data: submissions 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;