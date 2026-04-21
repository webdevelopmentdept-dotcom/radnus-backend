// routes/incentiveResults.js
const express             = require("express");
const router              = express.Router();
const IncentiveResult     = require("../models/IncentiveResult");
const IncentivePlan       = require("../models/IncentivePlan");
const IncentiveAssignment = require("../models/IncentiveAssignment");

// ── Slab calculator (mirrors frontend logic exactly) ─────────────────────────
function calcAmount(plan, finalScore, salary = 0) {
  if (!plan?.slabs) return 0;
  const score = Math.round(finalScore || 0);
  const slab  = plan.slabs.find(s => score >= s.min_score && score <= s.max_score);
  if (!slab || slab.type === "none") return 0;
  return slab.type === "percentage"
    ? Math.round((slab.value / 100) * salary)
    : slab.value;
}

// GET /api/incentive-results
router.get("/", async (req, res) => {
  try {
    const results = await IncentiveResult.find()
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs")
      .sort({ createdAt: -1 });

    // Optional filters
    let data = results;
    if (req.query.status)     data = data.filter(r => r.status === req.query.status.toLowerCase());
    if (req.query.period)     data = data.filter(r => r.cycle_period === req.query.period);
    if (req.query.department) data = data.filter(r => r.employee_id?.department === req.query.department);

    res.json({ success: true, data, total: data.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/incentive-results/employee/:employeeId  ← MyIncentive.jsx
// ⚠️ This route MUST be before /:id to avoid conflict
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const results = await IncentiveResult.find({ employee_id: req.params.employeeId })
      .populate("plan_id",     "name department cycle slabs")
      .populate("employee_id", "name department designation salary")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/incentive-results/generate  ← Bulk generate for a period
// Body: { period: "2026-04" }
router.post("/generate", async (req, res) => {
  try {
    const { period } = req.body;
    if (!period) return res.status(400).json({ success: false, message: "period required" });

    const assignments = await IncentiveAssignment.find({ period })
      .populate("employee_id")
      .populate("plan_id");

    // Try PerformanceReview model for auto score pull
    let PerformanceReview;
    try { PerformanceReview = require("../models/PerformanceReview"); } catch {}

    let created = 0, skipped = 0;

    for (const asgn of assignments) {
      const empId = asgn.employee_id?._id || asgn.employee_id;
      const existing = await IncentiveResult.findOne({ employee_id: empId, cycle_period: period });
      if (existing) { skipped++; continue; }

      let performance_score = 0;
      if (PerformanceReview) {
        const review = await PerformanceReview.findOne({ employee_id: empId }).sort({ createdAt: -1 });
        performance_score = review?.final_score || review?.score || 0;
      }

      const salary            = asgn.employee_id?.salary || 0;
      const calculated_amount = calcAmount(asgn.plan_id, performance_score, salary);

      await new IncentiveResult({
        employee_id: empId, plan_id: asgn.plan_id?._id, assignment_id: asgn._id,
        performance_score, salary, calculated_amount,
        cycle: asgn.cycle, cycle_period: period, status: "pending",
      }).save();
      created++;
    }

    res.status(201).json({ success: true, message: `${created} created, ${skipped} skipped`, created, skipped });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/incentive-results/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await IncentiveResult.findById(req.params.id)
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs");
    if (!result) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/incentive-results
router.post("/", async (req, res) => {
  try {
    const { employee_id, plan_id, assignment_id, performance_score, salary, cycle_period, cycle } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: "employee_id required" });

    let calculated_amount = 0;
    let resolvedPlanId    = plan_id;

    if (plan_id) {
      const plan = await IncentivePlan.findById(plan_id);
      calculated_amount = calcAmount(plan, performance_score, salary || 0);
    } else if (assignment_id) {
      const asgn = await IncentiveAssignment.findById(assignment_id).populate("plan_id");
      if (asgn?.plan_id) {
        resolvedPlanId    = asgn.plan_id._id;
        calculated_amount = calcAmount(asgn.plan_id, performance_score, salary || 0);
      }
    }

    const result = await new IncentiveResult({
      employee_id, plan_id: resolvedPlanId, assignment_id,
      performance_score: performance_score || 0,
      salary: salary || 0, calculated_amount,
      cycle: cycle || "Monthly", cycle_period, status: "pending",
    }).save();

    const populated = await IncentiveResult.findById(result._id)
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs");

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/incentive-results/:id  ← approve / mark paid
router.put("/:id", async (req, res) => {
  try {
    const allowed = ["pending", "approved", "paid"];
    if (req.body.status && !allowed.includes(req.body.status))
      return res.status(400).json({ success: false, message: "Invalid status" });

    const result = await IncentiveResult.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs");

    if (!result) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/incentive-results/:id
router.delete("/:id", async (req, res) => {
  try {
    const result = await IncentiveResult.findByIdAndDelete(req.params.id);
    if (!result) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;