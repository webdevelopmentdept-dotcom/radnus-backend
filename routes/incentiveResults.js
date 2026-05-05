// routes/incentiveResults.js
const express             = require("express");
const router              = express.Router();
const IncentiveResult     = require("../models/IncentiveResult");
const IncentivePlan       = require("../models/IncentivePlan");
const IncentiveAssignment = require("../models/IncentiveAssignment");

// ── Shared populate fields (all routes use this) ──────────────────────────────
const PLAN_FIELDS = [
  "name",
  "department",
  "cycle",
  "slabs",
  "plan_type",
  "kpi_configs",                 // ← ADDED: needed for KPI breakdown on employee side
  "period_type",                 // ← ADDED: needed for period label
  "period_year",                 // ← ADDED
  "period_month",                // ← ADDED
  "period_quarter",              // ← ADDED
  "period_half",                 // ← ADDED
  "standalone_payout_type",
  "standalone_payout_value",
  "standalone_metric",
  "standalone_metric_label",
  "completion_reward_type",
  "completion_reward_value",
  "completion_reward_label",
].join(" ");

const EMP_FIELDS = "name email department designation salary";

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

// ── Unified calculator ────────────────────────────────────────────────────────
function calcAmount(plan, finalScore, salary = 0, qualifies = true) {
  if (!plan) return 0;
  if (plan.plan_type === "standalone") {
    return qualifies ? calcStandaloneAmount(plan, salary) : 0;
  }
  return calcKpiAmount(plan, finalScore, salary);
}

// ── Check if ALL kpi_configs are achieved at >= 100% ─────────────────────────
function checkAllKpisComplete(plan, kpiActuals = []) {
  if (!plan?.kpi_configs?.length) return false;
  return plan.kpi_configs.every(cfg => {
    const actual    = kpiActuals.find(a => a.kpi_name === cfg.kpi_name);
    if (!actual) return false;
    const actualVal = Number(actual.actual_value || 0);
    const targetVal = Number(cfg.target || 0);
    if (targetVal === 0) return false;
    return (actualVal / targetVal) * 100 >= 100;
  });
}

// ── Calculate completion reward if ALL KPIs >= 100% ──────────────────────────
function calcCompletionReward(plan, salary = 0, kpiActuals = []) {
  if (!plan) return 0;
  if (plan.completion_reward_type === "none" || !plan.completion_reward_value) return 0;
  if (!checkAllKpisComplete(plan, kpiActuals)) return 0;
  if (plan.completion_reward_type === "percentage") {
    return Math.round((plan.completion_reward_value / 100) * salary);
  }
  return plan.completion_reward_value;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/incentive-results
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const results = await IncentiveResult.find()
      .populate("employee_id", EMP_FIELDS)
      .populate("plan_id", PLAN_FIELDS)
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

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/incentive-results/employee/:employeeId
// ─────────────────────────────────────────────────────────────────────────────
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const results = await IncentiveResult.find({ employee_id: req.params.employeeId })
      .populate("plan_id", PLAN_FIELDS)        // ← now includes kpi_configs + period fields
      .populate("employee_id", EMP_FIELDS)
      .sort({ createdAt: -1 });

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/incentive-results/generate  ← Bulk generate for a period
// Body: { period: "2026-05" }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/generate", async (req, res) => {
  try {
    const { period } = req.body;
    if (!period) return res.status(400).json({ success: false, message: "period required" });

    const assignments = await IncentiveAssignment.find({ period })
      .populate("employee_id")
      .populate({
        path: "plan_id",
        populate: { path: "kpi_template_id" },
      });

    // Load optional models safely
    let KpiActual, KpiAssignment, PerformanceReview;
    try { KpiActual       = require("../models/KpiActual");         } catch {}
    try { KpiAssignment   = require("../models/KpiAssignment");     } catch {}
    try { PerformanceReview = require("../models/PerformanceReview"); } catch {}

    let created = 0, skipped = 0;

    for (const asgn of assignments) {
      const empId = asgn.employee_id?._id || asgn.employee_id;

      const existing = await IncentiveResult.findOne({
        employee_id: empId,
        cycle_period: period,
      });
      if (existing) { skipped++; continue; }

      const salary = asgn.employee_id?.salary || 0;
      const plan   = asgn.plan_id;

      let performance_score      = 0;
      let calculated_amount      = 0;
      let completion_bonus       = 0;
      let completion_bonus_label = "";

      if (plan?.plan_type === "standalone") {
        // ── Standalone: fixed payout, no KPI check ──────────────────────────
        calculated_amount = calcStandaloneAmount(plan, salary);
        performance_score = 100;

      } else {
        // ── KPI-Linked ───────────────────────────────────────────────────────

        // STEP 1: Fetch per-KPI actuals for this employee
        let kpiActuals = [];

        if (KpiAssignment && KpiActual) {
          const kpiAsgn = await KpiAssignment.findOne({
            employee_id: empId,
            status: { $in: ["active", "completed"] },
          }).sort({ createdAt: -1 });

          if (kpiAsgn) {
            const actuals  = await KpiActual.find({ assignment_id: kpiAsgn._id });
            const template = plan.kpi_template_id;

            if (template?.kpi_items?.length) {
              kpiActuals = actuals
                .map(a => {
                  const item = template.kpi_items.find(
                    k => String(k._id) === String(a.kpi_item_id)
                  );
                  return item
                    ? { kpi_name: item.kpi_name, actual_value: a.actual_value }
                    : null;
                })
                .filter(Boolean);
            }
          }
        }

        // STEP 2: Overall score from PerformanceReview
        if (PerformanceReview) {
          const review = await PerformanceReview.findOne({
            employee_id: empId,
          }).sort({ createdAt: -1 });
          performance_score = review?.final_score || review?.score || 0;
        }

        // STEP 3: Base KPI slab payout
        calculated_amount = calcKpiAmount(plan, performance_score, salary);

        // STEP 4: Completion bonus only if ALL KPIs >= 100%
        completion_bonus       = calcCompletionReward(plan, salary, kpiActuals);
        completion_bonus_label = plan?.completion_reward_label || "";
      }

      await new IncentiveResult({
        employee_id:           empId,
        plan_id:               plan?._id,
        assignment_id:         asgn._id,
        performance_score,
        salary,
        calculated_amount:     calculated_amount + completion_bonus,
        completion_bonus,
        completion_bonus_label,
        cycle:                 asgn.cycle,
        cycle_period:          period,
        status:                "pending",
      }).save();

      created++;
    }

    res.status(201).json({
      success: true,
      message: `${created} created, ${skipped} skipped`,
      created,
      skipped,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/incentive-results/:id
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const result = await IncentiveResult.findById(req.params.id)
      .populate("employee_id", EMP_FIELDS)
      .populate("plan_id", PLAN_FIELDS);

    if (!result) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/incentive-results
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      employee_id, plan_id, assignment_id,
      performance_score, salary, cycle_period, cycle,
      qualifies, kpi_actuals,
    } = req.body;

    if (!employee_id)
      return res.status(400).json({ success: false, message: "employee_id required" });

    let calculated_amount      = 0;
    let completion_bonus       = 0;
    let completion_bonus_label = "";
    let resolvedPlanId         = plan_id;

    if (plan_id) {
      const plan         = await IncentivePlan.findById(plan_id);
      calculated_amount  = calcAmount(plan, performance_score, salary || 0, qualifies !== false);
      completion_bonus       = calcCompletionReward(plan, salary || 0, kpi_actuals || []);
      completion_bonus_label = plan?.completion_reward_label || "";

    } else if (assignment_id) {
      const asgn = await IncentiveAssignment.findById(assignment_id).populate("plan_id");
      if (asgn?.plan_id) {
        resolvedPlanId         = asgn.plan_id._id;
        calculated_amount      = calcAmount(asgn.plan_id, performance_score, salary || 0, qualifies !== false);
        completion_bonus       = calcCompletionReward(asgn.plan_id, salary || 0, kpi_actuals || []);
        completion_bonus_label = asgn.plan_id?.completion_reward_label || "";
      }
    }

    const result = await new IncentiveResult({
      employee_id,
      plan_id:           resolvedPlanId,
      assignment_id,
      performance_score: performance_score || 0,
      salary:            salary || 0,
      calculated_amount: calculated_amount + completion_bonus,
      completion_bonus,
      completion_bonus_label,
      cycle:             cycle || "Monthly",
      cycle_period,
      status:            "pending",
    }).save();

    const populated = await IncentiveResult.findById(result._id)
      .populate("employee_id", EMP_FIELDS)
      .populate("plan_id", PLAN_FIELDS);

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/incentive-results/:id  ← approve / mark paid / recalculate
// ─────────────────────────────────────────────────────────────────────────────
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

    const result = await IncentiveResult.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    )
      .populate("employee_id", EMP_FIELDS)
      .populate("plan_id", PLAN_FIELDS);

    if (!result) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/incentive-results/:id
// ─────────────────────────────────────────────────────────────────────────────
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