// routes/incentiveResults.js
const express             = require("express");
const router              = express.Router();
const IncentiveResult     = require("../models/IncentiveResult");
const IncentivePlan       = require("../models/IncentivePlan");
const IncentiveAssignment = require("../models/IncentiveAssignment");

// ── KPI-Linked slab calculator ────────────────────────────────────────────────
function calcKpiAmount(plan, finalScore, salary = 0) {
  if (!plan?.slabs?.length) return 0;
  const score = Math.round(finalScore || 0);
  const slab  = plan.slabs.find(s => score >= s.min_score && score <= s.max_score);
  if (!slab || slab.type === "none") return 0;
  return slab.type === "percentage"
    ? Math.round((slab.value / 100) * salary)
    : slab.value;
}

// ── Standalone flat payout calculator ─────────────────────────────────────────
function calcStandaloneAmount(plan, salary = 0) {
  if (!plan || plan.plan_type !== "standalone") return 0;
  if (plan.standalone_payout_type === "percentage") {
    return Math.round((plan.standalone_payout_value / 100) * salary);
  }
  return plan.standalone_payout_value || 0;
}

// ── Unified calculator — routes to correct engine by plan_type ────────────────
function calcAmount(plan, finalScore, salary = 0, qualifies = true) {
  if (!plan) return 0;
  if (plan.plan_type === "standalone") {
    // qualifies = HR manually marks true/false for this employee in this cycle
    return qualifies ? calcStandaloneAmount(plan, salary) : 0;
  }
  return calcKpiAmount(plan, finalScore, salary);
}

// GET /api/incentive-results
router.get("/", async (req, res) => {
  try {
    const results = await IncentiveResult.find()
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs plan_type standalone_payout_type standalone_payout_value standalone_metric standalone_metric_label")
      .sort({ createdAt: -1 });

    let data = results;
    if (req.query.status)     data = data.filter(r => r.status === req.query.status.toLowerCase());
    if (req.query.period)     data = data.filter(r => r.cycle_period === req.query.period);
    if (req.query.department) data = data.filter(r => r.employee_id?.department === req.query.department);

    res.json({ success: true, data, total: data.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/incentive-results/employee/:employeeId
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const results = await IncentiveResult.find({ employee_id: req.params.employeeId })
      .populate("plan_id",     "name department cycle slabs plan_type standalone_payout_type standalone_payout_value standalone_metric standalone_metric_label")
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

    let PerformanceReview;
    try { PerformanceReview = require("../models/PerformanceReview"); } catch {}

    let created = 0, skipped = 0;

    for (const asgn of assignments) {
      const empId = asgn.employee_id?._id || asgn.employee_id;
      const existing = await IncentiveResult.findOne({ employee_id: empId, cycle_period: period });
      if (existing) { skipped++; continue; }

      const salary = asgn.employee_id?.salary || 0;
      const plan   = asgn.plan_id;

      let performance_score = 0;
      let calculated_amount = 0;

      if (plan?.plan_type === "standalone") {
        // Standalone: payout is fixed — score not needed
        // qualifies defaults to true; HR can override status later
        calculated_amount = calcStandaloneAmount(plan, salary);
        performance_score = 100; // sentinel meaning "fully qualifies"
      } else {
        // KPI-Linked: pull score from PerformanceReview
        if (PerformanceReview) {
          const review = await PerformanceReview.findOne({ employee_id: empId }).sort({ createdAt: -1 });
          performance_score = review?.final_score || review?.score || 0;
        }
        calculated_amount = calcKpiAmount(plan, performance_score, salary);
      }

      await new IncentiveResult({
        employee_id: empId, plan_id: plan?._id, assignment_id: asgn._id,
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
      .populate("plan_id",     "name department cycle slabs plan_type standalone_payout_type standalone_payout_value");
    if (!result) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/incentive-results
router.post("/", async (req, res) => {
  try {
    const { employee_id, plan_id, assignment_id, performance_score, salary, cycle_period, cycle, qualifies } = req.body;
    if (!employee_id) return res.status(400).json({ success: false, message: "employee_id required" });

    let calculated_amount = 0;
    let resolvedPlanId    = plan_id;

    if (plan_id) {
      const plan = await IncentivePlan.findById(plan_id);
      calculated_amount = calcAmount(plan, performance_score, salary || 0, qualifies !== false);
    } else if (assignment_id) {
      const asgn = await IncentiveAssignment.findById(assignment_id).populate("plan_id");
      if (asgn?.plan_id) {
        resolvedPlanId    = asgn.plan_id._id;
        calculated_amount = calcAmount(asgn.plan_id, performance_score, salary || 0, qualifies !== false);
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
      .populate("plan_id",     "name department cycle slabs plan_type standalone_payout_type standalone_payout_value");

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/incentive-results/:id  ← approve / mark paid / recalculate
router.put("/:id", async (req, res) => {
  try {
    const allowed = ["pending", "approved", "paid"];
    if (req.body.status && !allowed.includes(req.body.status))
      return res.status(400).json({ success: false, message: "Invalid status" });

    // If qualifies flag changes (standalone), recalculate amount
    if ("qualifies" in req.body) {
      const existing = await IncentiveResult.findById(req.params.id).populate("plan_id");
      if (existing?.plan_id?.plan_type === "standalone") {
        req.body.calculated_amount = calcAmount(
          existing.plan_id, 0, existing.salary, req.body.qualifies
        );
      }
    }

    const result = await IncentiveResult.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true })
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs plan_type standalone_payout_type standalone_payout_value");

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