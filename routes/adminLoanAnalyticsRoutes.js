const express = require("express");
const router = express.Router();
const LoanCustomer = require("../models/LoanCustomer");

// NOTE: Same pattern as adminLoanProcessRoutes.js — Admin-only, gated on the
// frontend via localStorage "admin-role". No JWT here (consistent with rest
// of the admin loan-process module).

// Order matters for the funnel — this is the real lifecycle sequence.
const STAGE_ORDER = [
  { key: "cibilVerification", label: "CIBIL Verification" },
  { key: "documentCollection", label: "Document Collection" },
  { key: "applicationProcess", label: "Application Process" },
  { key: "quotation", label: "Quotation" },
  { key: "auditorReference", label: "Auditor Reference" },
  { key: "documentPayment", label: "Document Payment" },
  { key: "finalisationVerification", label: "Finalisation & Verification" },
  { key: "finalSubmission", label: "Final Submission" },
  { key: "courier", label: "Courier" },
  { key: "completed", label: "Completed" },
];

// ══════════════════════════════════════════════════════
//  GET /api/admin-loan-analytics/overview
//  One combined payload for the whole Loan Analytics page.
//  Optional query: ?fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD  (applies to loanDate)
// ══════════════════════════════════════════════════════
router.get("/overview", async (req, res) => {
  try {
    const match = {};
    if (req.query.fromDate || req.query.toDate) {
      match.loanDate = {};
      if (req.query.fromDate) match.loanDate.$gte = new Date(req.query.fromDate);
      if (req.query.toDate) match.loanDate.$lte = new Date(`${req.query.toDate}T23:59:59`);
    }

    // ── Overall summary ─────────────────────────────────────────────
    const [summary] = await LoanCustomer.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          totalRevenue: { $sum: "$loanValue" },
          completedCount: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
          completedRevenue: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$loanValue", 0] } },
          inProgressCount: { $sum: { $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0] } },
          avgProgress: { $avg: "$processPercent" },
          pendingCount: {
            $sum: {
              $cond: [{ $and: [{ $ne: ["$reasonForPending", ""] }, { $ne: ["$reasonForPending", null] }] }, 1, 0],
            },
          },
        },
      },
    ]);

    // ── Scheme-wise breakdown (PMEGP / UYEGP / AABCS) ───────────────
    const schemeBreakdown = await LoanCustomer.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $ifNull: ["$scheme", "Not Set"] },
          applications: { $sum: 1 },
          revenue: { $sum: "$loanValue" },
          completedCount: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        },
      },
      { $project: { _id: 0, scheme: { $cond: [{ $eq: ["$_id", ""] }, "Not Set", "$_id"] }, applications: 1, revenue: 1, completedCount: 1 } },
      { $sort: { applications: -1 } },
    ]);

    // ── Telecaller leaderboard ──────────────────────────────────────
    const staffBreakdown = await LoanCustomer.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$staffId",
          staffName: { $first: "$staffName" },
          applications: { $sum: 1 },
          revenue: { $sum: "$loanValue" },
          completedCount: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
        },
      },
      {
        $project: {
          staffName: 1, applications: 1, revenue: 1, completedCount: 1,
          conversionRate: {
            $cond: [{ $eq: ["$applications", 0] }, 0, { $round: [{ $multiply: [{ $divide: ["$completedCount", "$applications"] }, 100] }, 0] }],
          },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    // ── Stage-wise funnel — how many customers have crossed each stage ──
    const funnelFacet = {};
    STAGE_ORDER.forEach((s) => {
      funnelFacet[s.key] = [{ $match: { ...match, [`checklist.${s.key}`]: true } }, { $count: "count" }];
    });
    const funnelRaw = await LoanCustomer.aggregate([{ $facet: funnelFacet }]);
    const funnelCounts = funnelRaw[0] || {};
    const funnel = STAGE_ORDER.map((s) => ({
      key: s.key,
      label: s.label,
      count: funnelCounts[s.key]?.[0]?.count || 0,
    }));

    // ── Monthly trend (last 12 months by loanDate) ──────────────────
    const monthlyTrend = await LoanCustomer.aggregate([
      { $match: match },
      {
        $group: {
          _id: { year: { $year: "$loanDate" }, month: { $month: "$loanDate" } },
          applications: { $sum: 1 },
          revenue: { $sum: "$loanValue" },
        },
      },
      { $sort: { "_id.year": 1, "_id.month": 1 } },
      { $limit: 12 },
      {
        $project: {
          _id: 0,
          label: {
            $concat: [
              { $arrayElemAt: [["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], "$_id.month"] },
              " ", { $toString: "$_id.year" },
            ],
          },
          applications: 1,
          revenue: 1,
        },
      },
    ]);

    // ── Bank-wise distribution ───────────────────────────────────────
    const bankBreakdown = await LoanCustomer.aggregate([
      { $match: match },
      { $match: { bankName: { $ne: "" } } },
      { $group: { _id: "$bankName", count: { $sum: 1 } } },
      { $project: { _id: 0, bankName: "$_id", count: 1 } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    // ── Business type distribution ───────────────────────────────────
    const businessTypeBreakdown = await LoanCustomer.aggregate([
      { $match: match },
      { $match: { businessType: { $ne: "" } } },
      { $group: { _id: "$businessType", count: { $sum: 1 } } },
      { $project: { _id: 0, businessType: "$_id", count: 1 } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    // ── Pending reasons summary ───────────────────────────────────────
    const pendingReasons = await LoanCustomer.aggregate([
      { $match: match },
      { $match: { reasonForPending: { $nin: ["", null] } } },
      { $group: { _id: "$reasonForPending", count: { $sum: 1 } } },
      { $project: { _id: 0, reason: "$_id", count: 1 } },
      { $sort: { count: -1 } },
      { $limit: 8 },
    ]);

    // ── Recent activity feed ─────────────────────────────────────────
    const recentActivity = await LoanCustomer.find(match)
      .sort({ updatedAt: -1 })
      .limit(8)
      .select("customerName staffName status processPercent updatedAt scheme");

    res.json({
      success: true,
      data: {
        summary: {
          totalApplications: summary?.totalApplications || 0,
          totalRevenue: summary?.totalRevenue || 0,
          completedCount: summary?.completedCount || 0,
          completedRevenue: summary?.completedRevenue || 0,
          inProgressCount: summary?.inProgressCount || 0,
          avgProgress: summary?.avgProgress ? Math.round(summary.avgProgress) : 0,
          pendingCount: summary?.pendingCount || 0,
        },
        schemeBreakdown,
        staffBreakdown,
        funnel,
        monthlyTrend,
        bankBreakdown,
        businessTypeBreakdown,
        pendingReasons,
        recentActivity,
      },
    });
  } catch (err) {
    console.error("LOAN ANALYTICS OVERVIEW ERROR", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;