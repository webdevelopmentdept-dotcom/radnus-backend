
const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth"); 
const adminOnly = require("../middleware/adminOnly"); 

const Applicant    = require("../models/Applicant");
const Partner      = require("../models/Partner");
const Lead         = require("../models/Lead");
const Employee     = require("../models/Employee");
const Advance      = require("../models/Advance");
const LoanCustomer = require("../models/LoanCustomer");
const ShopOwner    = require("../models/ShopOwner");
const Technician   = require("../models/Technician");
const { buildModeFilter } = require("../utils/loanMode");

const DAY = 24 * 60 * 60 * 1000;

/* ---------- helpers ---------- */
// returns { from, prevFrom } for the selected range (null = all time)
function resolveRange(range) {
  const now = new Date();
  if (range === "all") return { from: null, prevFrom: null, now };

  let from;
  if (range === "year") {
    from = new Date(now.getFullYear(), 0, 1);
  } else {
    const days = { "7d": 7, "30d": 30, "90d": 90 }[range] || 30;
    from = new Date(now.getTime() - days * DAY);
  }
  const span = now.getTime() - from.getTime();
  const prevFrom = new Date(from.getTime() - span);
  return { from, prevFrom, now };
}

// run a section; if it fails, log it and return fallback so the dashboard still loads
async function safe(name, fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    console.error(`Dashboard section error [${name}]:`, e.message);
    return fallback;
  }
}

/* ================= GET /api/admin-dashboard/stats ================= */
router.get("/stats", auth, adminOnly, async (req, res) => {
  try {
    const range = ["7d", "30d", "90d", "year", "all"].includes(req.query.range)
      ? req.query.range
      : "all";
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const { from, prevFrom, now } = resolveRange(range);

    const loanMode = await buildModeFilter(req.query.mode); // "bde" | "marketing" | undefined

    const yearStart = new Date(year, 0, 1);
    const yearEnd   = new Date(year + 1, 0, 1);
    const staleDate = new Date(now.getTime() - 3 * DAY);
    const monthBegin = new Date(now.getFullYear(), now.getMonth(), 1);

    // {field: {$gte: from}} or {} for all-time
    const inRange = (field) => (from ? { [field]: { $gte: from } } : {});
    const inPrev  = (field) => ({ [field]: { $gte: prevFrom, $lt: from } });

    // { total (all-time), current (selected range), previous (period before) }
    const counts = async (Model, field, extra = {}) => {
      const total = await Model.countDocuments(extra);
      if (!from) return { total, current: total, previous: null };
      const [current, previous] = await Promise.all([
        Model.countDocuments({ ...extra, ...inRange(field) }),
        Model.countDocuments({ ...extra, ...inPrev(field) }),
      ]);
      return { total, current, previous };
    };

    const [
      applicants, courses, partners, leads, leadStatus, advanceCollected,
      topPartners, monthlyLeads, monthlyApplicants, staleLeads,
      employees, pendingApprovals, advances,
      loanDetail, technicians, shopOwners, recent,
    ] = await Promise.all([
      /* ---------- Applicants ---------- */
      safe("applicants", () => counts(Applicant, "createdAt"), { total: 0, current: 0, previous: null }),

      safe("courses", async () => {
        const rows = await Applicant.aggregate([
          { $match: inRange("createdAt") },
          { $group: { _id: { $toUpper: { $trim: { input: { $ifNull: ["$course", "Unknown"] } } } }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 8 },
        ]);
        return rows.map((r) => ({ course: r._id || "UNKNOWN", count: r.count }));
      }, []),

      /* ---------- Channel partners ---------- */
      safe("partners", async () => ({
        ...(await counts(Partner, "createdAt")),
        disabled: await Partner.countDocuments({ disabled: true }),
      }), { total: 0, current: 0, previous: null, disabled: 0 }),

      /* ---------- Leads ---------- */
      safe("leads", () => counts(Lead, "createdAt"), { total: 0, current: 0, previous: null }),

      safe("leadStatus", async () => {
        const rows = await Lead.aggregate([
          { $match: inRange("createdAt") },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);
        const out = { PENDING: 0, CONTACTED: 0, CONVERTED: 0, REJECTED: 0 };
        rows.forEach((r) => { if (r._id in out) out[r._id] = r.count; });
        return out;
      }, { PENDING: 0, CONTACTED: 0, CONVERTED: 0, REJECTED: 0 }),

      safe("advanceCollected", async () => {
        const [cur, prev] = await Promise.all([
          Lead.aggregate([{ $match: inRange("createdAt") }, { $group: { _id: null, sum: { $sum: "$advance" } } }]),
          from
            ? Lead.aggregate([{ $match: inPrev("createdAt") }, { $group: { _id: null, sum: { $sum: "$advance" } } }])
            : Promise.resolve([]),
        ]);
        return { current: cur[0]?.sum || 0, previous: from ? (prev[0]?.sum || 0) : null };
      }, { current: 0, previous: null }),

      safe("topPartners", async () => {
        const rows = await Lead.aggregate([
          { $match: inRange("createdAt") },
          { $group: { _id: "$partnerId", name: { $first: "$partnerName" }, leads: { $sum: 1 }, advance: { $sum: "$advance" },
                      converted: { $sum: { $cond: [{ $eq: ["$status", "CONVERTED"] }, 1, 0] } } } },
          { $sort: { leads: -1, advance: -1 } },
          { $limit: 5 },
        ]);
        return rows.map((r) => ({ name: r.name || "Unknown", leads: r.leads, advance: r.advance, converted: r.converted }));
      }, []),

      /* ---------- Monthly (own year selector) ---------- */
      safe("monthlyLeads", async () => {
        const rows = await Lead.aggregate([
          { $match: { createdAt: { $gte: yearStart, $lt: yearEnd } } },
          { $group: { _id: { $month: "$createdAt" }, count: { $sum: 1 } } },
        ]);
        const arr = Array(12).fill(0);
        rows.forEach((r) => { arr[r._id - 1] = r.count; });
        return arr;
      }, Array(12).fill(0)),

      safe("monthlyApplicants", async () => {
        const rows = await Applicant.aggregate([
          { $match: { createdAt: { $gte: yearStart, $lt: yearEnd } } },
          { $group: { _id: { $month: "$createdAt" }, count: { $sum: 1 } } },
        ]);
        const arr = Array(12).fill(0);
        rows.forEach((r) => { arr[r._id - 1] = r.count; });
        return arr;
      }, Array(12).fill(0)),

      /* ---------- Always live: stale leads ---------- */
      safe("staleLeads", async () => {
        const filter = { status: "PENDING", createdAt: { $lt: staleDate } };
        const [count, list] = await Promise.all([
          Lead.countDocuments(filter),
          Lead.find(filter).sort({ createdAt: 1 }).limit(5).select("name phone course partnerName createdAt").lean(),
        ]);
        return { count, list };
      }, { count: 0, list: [] }),

      /* ---------- Always live: employees ---------- */
      safe("employees", async () => ({
        active: await Employee.countDocuments({ status: { $in: ["active", "approved"] } }),
      }), { active: 0 }),

      safe("pendingApprovals", async () => {
        const filter = { status: "admin_pending" };
        const [count, list] = await Promise.all([
          Employee.countDocuments(filter),
          Employee.find(filter).sort({ updatedAt: -1 }).limit(5).select("name department designation createdAt").lean(),
        ]);
        return { count, list };
      }, { count: 0, list: [] }),

      safe("advances", async () => {
        const r = await Advance.aggregate([
          { $match: { status: "pending" } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
        ]);
        return { count: r[0]?.count || 0, amount: r[0]?.amount || 0 };
      }, { count: 0, amount: 0 }),

      /* ================= LOAN (main section) ================= */
      safe("loanDetail", async () => {
        const STAGES = [
          ["cibilVerification", "CIBIL"], ["documentCollection", "Doc Collection"],
          ["applicationProcess", "Application"], ["quotation", "Quotation"],
          ["auditorReference", "Auditor Ref"], ["documentPayment", "Doc Payment"],
          ["finalisationVerification", "Finalisation"], ["finalSubmission", "Final Submission"],
          ["courier", "Courier"], ["completed", "Completed"],
        ];

        // customers created (loanDate) inside the selected range
        const loanRange = { ...loanMode, ...inRange("loanDate") };

        const funnelFacet = {};
        STAGES.forEach(([k]) => {
          funnelFacet[k] = [{ $match: { ...loanRange, [`checklist.${k}`]: true } }, { $count: "count" }];
        });

        // expression helpers for $group
        const loanIn = (extra) =>
          from ? { $and: [{ $gte: ["$loanDate", from] }, extra] } : extra;
        const docPaid = { $eq: ["$checklist.documentPayment", true] };
        const payIn = from
          ? { $and: [docPaid, { $gte: ["$checklistDates.documentPayment", from] }] }
          : docPaid;
        const amt = { $ifNull: ["$checklistAmounts.documentPayment", 0] };
        const isDone = { $eq: ["$status", "COMPLETED"] };
        const isProg = { $eq: ["$status", "IN_PROGRESS"] };

        const [summaryArr, funnelRaw, schemes, staff, reasons, docMonthly, prevTotal, prevDoc] = await Promise.all([
          LoanCustomer.aggregate([
            { $match: loanMode },
            { $group: {
                _id: null,
                /* ---- follow the selected range ---- */
                total:          { $sum: { $cond: [loanIn(true), 1, 0] } },
                value:          { $sum: { $cond: [loanIn(true), "$loanValue", 0] } },
                completed:      { $sum: { $cond: [loanIn(isDone), 1, 0] } },
                completedValue: { $sum: { $cond: [loanIn(isDone), "$loanValue", 0] } },
                inProgress:     { $sum: { $cond: [loanIn(isProg), 1, 0] } },
                progressSum:    { $sum: { $cond: [loanIn(true), { $ifNull: ["$processPercent", 0] }, 0] } },
                docPaidCount:   { $sum: { $cond: [payIn, 1, 0] } },
                docCollected:   { $sum: { $cond: [payIn, amt, 0] } },
                sanctioned:      { $sum: { $cond: [loanIn({ $eq: ["$followup.status", "COMPLETED"] }), 1, 0] } },
                sanctionedValue: { $sum: { $cond: [loanIn({ $eq: ["$followup.status", "COMPLETED"] }), "$loanValue", 0] } },
                /* ---- always live (all-time) ---- */
                docCollectedThisMonth: { $sum: { $cond: [
                  { $and: [docPaid, { $gte: ["$checklistDates.documentPayment", monthBegin] }] }, amt, 0] } },
                docPendingCount: { $sum: { $cond: [
                  { $and: [{ $ne: ["$checklist.documentPayment", true] }, isProg] }, 1, 0] } },
                pendingWithReason: { $sum: { $cond: [
                  { $and: [isProg, { $ne: [{ $ifNull: ["$reasonForPending", ""] }, ""] }] }, 1, 0] } },
                followupPending: { $sum: { $cond: [{ $eq: ["$followup.status", "PENDING"] }, 1, 0] } },
                incentiveCount:  { $sum: { $cond: [{ $eq: ["$incentive.eligibility", "Eligible for Processing"] }, 1, 0] } },
                incentiveAmount: { $sum: { $cond: [{ $eq: ["$incentive.eligibility", "Eligible for Processing"] }, { $ifNull: ["$incentive.amount", 0] }, 0] } },
            } },
          ]),
          LoanCustomer.aggregate([{ $facet: funnelFacet }]),
          LoanCustomer.aggregate([
            { $match: { ...loanRange, scheme: { $nin: ["", null] } } },
            { $group: { _id: "$scheme", count: { $sum: 1 },
                        completed: { $sum: { $cond: [isDone, 1, 0] } } } },
            { $sort: { count: -1 } },
          ]),
          LoanCustomer.aggregate([
            { $match: loanMode },
            { $group: {
                _id: "$staffId", name: { $first: "$staffName" },
                total:        { $sum: { $cond: [loanIn(true), 1, 0] } },
                completed:    { $sum: { $cond: [loanIn(isDone), 1, 0] } },
                docCollected: { $sum: { $cond: [payIn, amt, 0] } },
            } },
            { $match: { $or: [{ total: { $gt: 0 } }, { docCollected: { $gt: 0 } }] } },
            { $sort: { completed: -1, total: -1 } },
            { $limit: 5 },
          ]),
          LoanCustomer.aggregate([
            { $match: { ...loanMode, status: "IN_PROGRESS", reasonForPending: { $nin: ["", null] } } },
            { $group: { _id: "$reasonForPending", count: { $sum: 1 } } },
            { $sort: { count: -1 } },
            { $limit: 5 },
          ]),
          // monthly doc payment trend – last 6 months (independent of the range filter)
          LoanCustomer.aggregate([
            { $match: { ...loanMode, "checklist.documentPayment": true, "checklistDates.documentPayment": { $ne: null } } },
            { $group: {
                _id: { y: { $year: "$checklistDates.documentPayment" }, m: { $month: "$checklistDates.documentPayment" } },
                amount: { $sum: amt },
                count: { $sum: 1 },
            } },
            { $sort: { "_id.y": -1, "_id.m": -1 } },
            { $limit: 6 },
          ]),
          // previous period (for ▲▼ trend)
          from ? LoanCustomer.countDocuments({ ...loanMode, ...inPrev("loanDate") }) : Promise.resolve(null),
          from
            ? LoanCustomer.aggregate([
                { $match: { ...loanMode, "checklist.documentPayment": true, ...inPrev("checklistDates.documentPayment") } },
                { $group: { _id: null, sum: { $sum: amt } } },
              ])
            : Promise.resolve(null),
        ]);

        const sm = summaryArr[0] || {};
        const fc = funnelRaw[0] || {};
        const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return {
          total: sm.total || 0,
          totalPrev: prevTotal,
          value: sm.value || 0,
          completed: sm.completed || 0,
          completedValue: sm.completedValue || 0,
          inProgress: sm.inProgress || 0,
          avgProgress: sm.total ? Math.round((sm.progressSum || 0) / sm.total) : 0,
          docPaidCount: sm.docPaidCount || 0,
          docCollected: sm.docCollected || 0,
          docCollectedPrev: prevDoc ? (prevDoc[0]?.sum || 0) : null,
          sanctioned: sm.sanctioned || 0,
          sanctionedValue: sm.sanctionedValue || 0,
          // always live
          docCollectedThisMonth: sm.docCollectedThisMonth || 0,
          docPendingCount: sm.docPendingCount || 0,
          pendingWithReason: sm.pendingWithReason || 0,
          followupPending: sm.followupPending || 0,
          incentiveCount: sm.incentiveCount || 0,
          incentiveAmount: sm.incentiveAmount || 0,
          funnel: STAGES.map(([k, label]) => ({ key: k, label, count: fc[k]?.[0]?.count || 0 })),
          schemes: schemes.map((r) => ({ scheme: r._id, count: r.count, completed: r.completed })),
          staff: staff.map((r) => ({ name: r.name || "Unknown", total: r.total, completed: r.completed, docCollected: r.docCollected || 0 })),
          reasons: reasons.map((r) => ({ reason: r._id, count: r.count })),
          docMonthly: docMonthly.reverse().map((r) => ({ label: `${MON[r._id.m - 1]} ${String(r._id.y).slice(2)}`, amount: r.amount, count: r.count })),
        };
      }, null),

      /* ---------- Technicians (registered in range) ---------- */
      safe("technicians", async () => {
        const rows = await Technician.aggregate([
          { $match: inRange("createdAt") },
          { $group: { _id: "$status", count: { $sum: 1 } } },
        ]);
        const out = { New: 0, Available: 0, Interview: 0, Hired: 0, Archived: 0 };
        let total = 0;
        rows.forEach((r) => { total += r.count; if (r._id in out) out[r._id] = r.count; });
        const prev = from ? await Technician.countDocuments(inPrev("createdAt")) : null;
        return { total, previous: prev, ...out };
      }, { total: 0, previous: null, New: 0, Available: 0, Interview: 0, Hired: 0, Archived: 0 }),

      /* ---------- Shop owners (registered in range) ---------- */
      safe("shopOwners", async () => {
        const rows = await ShopOwner.aggregate([
          { $match: inRange("createdAt") },
          { $group: { _id: "$jobStatus", count: { $sum: 1 } } },
        ]);
        const out = { Pending: 0, Open: 0, "In Process": 0, Completed: 0, Archived: 0 };
        let total = 0;
        rows.forEach((r) => { total += r.count; if (r._id in out) out[r._id] = r.count; });
        const prev = from ? await ShopOwner.countDocuments(inPrev("createdAt")) : null;
        return { total, previous: prev, ...out };
      }, { total: 0, previous: null, Pending: 0, Open: 0, "In Process": 0, Completed: 0, Archived: 0 }),

      /* ---------- Recent activity (always latest) ---------- */
      safe("recent", async () => {
        const [a, l, p, s, t] = await Promise.all([
          Applicant.find().sort({ createdAt: -1 }).limit(5).select("name course createdAt").lean(),
          Lead.find().sort({ createdAt: -1 }).limit(5).select("name partnerName createdAt").lean(),
          Partner.find().sort({ createdAt: -1 }).limit(5).select("name createdAt").lean(),
          ShopOwner.find().sort({ createdAt: -1 }).limit(5).select("shopName ownerName district createdAt").lean(),
          Technician.find().sort({ createdAt: -1 }).limit(5).select("fullName district createdAt").lean(),
        ]);
        const items = [
          ...a.map((x) => ({ type: "applicant", title: x.name, sub: x.course, at: x.createdAt })),
          ...l.map((x) => ({ type: "lead", title: x.name, sub: x.partnerName ? `via ${x.partnerName}` : "", at: x.createdAt })),
          ...p.map((x) => ({ type: "partner", title: x.name, sub: "New channel partner", at: x.createdAt })),
          ...s.map((x) => ({ type: "shop", title: x.shopName || x.ownerName, sub: x.district || "", at: x.createdAt })),
          ...t.map((x) => ({ type: "technician", title: x.fullName, sub: x.district || "", at: x.createdAt })),
        ];
        return items
          .filter((i) => i.at)
          .sort((x, y) => new Date(y.at) - new Date(x.at))
          .slice(0, 10);
      }, []),
    ]);

    res.json({
      success: true,
      range,
      year,
      generatedAt: new Date(),
      applicants, courses, partners, leads, leadStatus, advanceCollected,
      topPartners, monthlyLeads, monthlyApplicants, staleLeads,
      employees, pendingApprovals, advances,
      loanDetail, technicians, shopOwners, recent,
    });
  } catch (err) {
    console.error("Admin dashboard stats error:", err);
    res.status(500).json({ success: false, message: "Failed to load dashboard stats" });
  }
});

module.exports = router;