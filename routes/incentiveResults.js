// routes/incentiveResults.js
const express             = require("express");
const router              = express.Router();
const IncentiveResult     = require("../models/IncentiveResult");
const IncentivePlan       = require("../models/IncentivePlan");
const IncentiveAssignment = require("../models/IncentiveAssignment");

// ── Shared populate fields ────────────────────────────────────────────────────
const PLAN_FIELDS = [
  "name", "department", "cycle", "slabs", "plan_type",
  "kpi_configs",
  "period_type", "period_year", "period_month", "period_quarter", "period_half",
  "standalone_payout_type", "standalone_payout_value",
  "standalone_metric", "standalone_metric_label",
  "completion_reward_type", "completion_reward_value", "completion_reward_label",
].join(" ");

const EMP_FIELDS = "name email department designation salary";

// ── Standalone flat payout calculator ────────────────────────────────────────
function calcStandaloneAmount(plan, salary = 0) {
  if (!plan || plan.plan_type !== "standalone") return 0;
  if (plan.standalone_payout_type === "percentage") {
    return Math.round((plan.standalone_payout_value / 100) * salary);
  }
  return plan.standalone_payout_value || 0;
}

// ── KPI-linked slab calculator (normal KPIs only) ─────────────────────────────
function calcNormalKpiAmount(cfg, kpiScore, salary = 0) {
  const slab = (cfg.slabs || []).find(
    s => kpiScore >= s.min_score && kpiScore <= s.max_score
  );
  if (!slab || slab.type === "none") return 0;
  if (slab.type === "target_percentage") return Math.round((slab.value / 100) * Number(cfg.target));
  if (slab.type === "percentage")        return Math.round((slab.value / 100) * salary);
  return slab.value;
}

// ── Admission KPI per-program calculator ─────────────────────────────────────
// kpiActuals: array of { kpi_name, program_id?, program_name?, actual_value }
function calcAdmissionKpiAmount(cfg, kpiActuals = [], salary = 0) {
  const programTargets = cfg.program_targets || [];
  const programSlabs   = cfg.program_slabs   || [];
  const normalize      = s => (s || "").toLowerCase().trim();

  let total = 0;

  programTargets.forEach(pt => {
    // Try to find actual for this specific program
    const actual = kpiActuals.find(k =>
      normalize(k.kpi_name) === normalize(cfg.kpi_name) &&
      (k.program_id === pt.program_id || normalize(k.program_name) === normalize(pt.program_name))
    );

    // Fallback: if only one program and no program_id in actual, use the kpi_name match
    const actualValue = actual?.actual_value ??
      (programTargets.length === 1
        ? kpiActuals.find(k => normalize(k.kpi_name) === normalize(cfg.kpi_name))?.actual_value
        : 0) ?? 0;

    const programTarget = Number(pt.target) || 0;
    if (programTarget === 0) return;

    const achPct = Math.min(Math.round((Number(actualValue) / programTarget) * 100), 100);

    const progSlabEntry = programSlabs.find(ps => ps.program_id === pt.program_id);
    const slabs         = progSlabEntry?.slabs || [];
    const slab          = slabs.find(s => achPct >= s.min_score && achPct <= s.max_score);

    if (!slab || slab.type === "none") return;

    if (slab.type === "target_percentage") {
      total += Math.round((slab.value / 100) * programTarget);
    } else if (slab.type === "percentage") {
      total += Math.round((slab.value / 100) * salary);
    } else {
      total += slab.value;
    }
  });

  return total;
}

// ── Full KPI-linked calculator (handles both normal + admission KPIs) ─────────
function calcKpiLinkedAmount(plan, finalScore, salary = 0, kpiActuals = []) {
  const kpiConfigs = plan.kpi_configs || [];
  const normalize  = s => (s || "").toLowerCase().trim();

  let total = 0;

  kpiConfigs.forEach(cfg => {
    if (cfg.is_admission_kpi) {
      // Admission KPI: per-program slab calculation
      total += calcAdmissionKpiAmount(cfg, kpiActuals, salary);
    } else {
      // Normal KPI: score-based slab
      const kpiData = kpiActuals.find(k => normalize(k.kpi_name) === normalize(cfg.kpi_name));
      let kpiScore  = 0;
      if (kpiData) {
        if (kpiData.target && Number(kpiData.target) > 0) {
          kpiScore = Math.min(
            Math.round((Number(kpiData.actual_value) / Number(kpiData.target)) * 100), 100
          );
        } else {
          kpiScore = Math.round(kpiData.pct_achieved ?? kpiData.actual_value ?? 0);
        }
      } else {
        // Fallback to overall final_score if no per-KPI data
        kpiScore = Math.round(finalScore || 0);
      }
      total += calcNormalKpiAmount(cfg, kpiScore, salary);
    }
  });

  return total;
}

// ── Completion reward ─────────────────────────────────────────────────────────
function calcCompletionReward(plan, salary = 0, kpiActuals = []) {
  if (!plan) return 0;
  if (plan.completion_reward_type === "none" || !plan.completion_reward_value) return 0;

  const kpiConfigs = plan.kpi_configs || [];
  if (!kpiConfigs.length) return 0;

  const normalize = s => (s || "").toLowerCase().trim();

  const allComplete = kpiConfigs.every(cfg => {
    if (cfg.is_admission_kpi) {
      // All programs must hit 100%
      return (cfg.program_targets || []).every(pt => {
        const actual = kpiActuals.find(k =>
          normalize(k.kpi_name) === normalize(cfg.kpi_name) &&
          (k.program_id === pt.program_id || normalize(k.program_name) === normalize(pt.program_name))
        );
        if (!actual) return false;
        return Number(actual.actual_value) >= Number(pt.target);
      });
    } else {
      const actual = kpiActuals.find(k => normalize(k.kpi_name) === normalize(cfg.kpi_name));
      if (!actual) return false;
      if (actual.target && Number(actual.target) > 0) {
        return (Number(actual.actual_value) / Number(actual.target)) >= 1;
      }
      return false;
    }
  });

  if (!allComplete) return 0;

  return plan.completion_reward_type === "percentage"
    ? Math.round((plan.completion_reward_value / 100) * salary)
    : plan.completion_reward_value;
}

// ── Unified calculator ────────────────────────────────────────────────────────
function calcAmount(plan, finalScore, salary = 0, qualifies = true, kpiActuals = []) {
  if (!plan) return 0;
  if (plan.plan_type === "standalone") {
    return qualifies ? calcStandaloneAmount(plan, salary) : 0;
  }
  return calcKpiLinkedAmount(plan, finalScore, salary, kpiActuals);
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
      .populate("plan_id", PLAN_FIELDS)
      .populate("employee_id", EMP_FIELDS)
      .sort({ createdAt: -1 });

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/incentive-results/generate  ← Bulk generate for a period
// ─────────────────────────────────────────────────────────────────────────────
router.post("/generate", async (req, res) => {
  try {
    const { period } = req.body;
    if (!period) return res.status(400).json({ success: false, message: "period required" });

    const assignments = await IncentiveAssignment.find({ period })
      .populate("employee_id")
      .populate({ path: "plan_id", populate: { path: "kpi_template_id" } });

    let KpiActual, KpiAssignment, PerformanceReview;
    try { KpiActual         = require("../models/KpiActual");          } catch {}
    try { KpiAssignment     = require("../models/KpiAssignment");      } catch {}
    try { PerformanceReview = require("../models/PerformanceReview");  } catch {}

    let created = 0, skipped = 0;

    for (const asgn of assignments) {
      const empId = asgn.employee_id?._id || asgn.employee_id;

      const existing = await IncentiveResult.findOne({ employee_id: empId, cycle_period: period });
      if (existing) { skipped++; continue; }

      const salary = asgn.employee_id?.salary || 0;
      const plan   = asgn.plan_id;

      let performance_score      = 0;
      let calculated_amount      = 0;
      let completion_bonus       = 0;
      let completion_bonus_label = "";
      let kpi_breakdown          = [];

      if (plan?.plan_type === "standalone") {
        calculated_amount = calcStandaloneAmount(plan, salary);
        performance_score = 100;

      } else {
        // ── Fetch per-KPI actuals ──
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
                  const item = template.kpi_items.find(k => String(k._id) === String(a.kpi_item_id));
                  if (!item) return null;
                  return {
                    kpi_name:     item.kpi_name,
                    actual_value: a.actual_value,
                    target:       item.target || 0,
                    // Carry program info for admission KPIs
                    program_id:   a.program_id   || null,
                    program_name: a.program_name || null,
                  };
                })
                .filter(Boolean);
            }
          }
        }

        if (PerformanceReview) {
          const review  = await PerformanceReview.findOne({ employee_id: empId }).sort({ createdAt: -1 });
          performance_score = review?.final_score || review?.score || 0;
          kpi_breakdown     = review?.kpi_breakdown || kpiActuals;
        } else {
          kpi_breakdown = kpiActuals;
        }

        // ── Calculate: normal KPIs + admission KPIs per-program ──
        calculated_amount      = calcKpiLinkedAmount(plan, performance_score, salary, kpiActuals);
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
        kpi_breakdown,
        cycle:                 asgn.cycle,
        cycle_period:          period,
        status:                "pending",
      }).save();

      created++;
    }

    res.status(201).json({ success: true, message: `${created} created, ${skipped} skipped`, created, skipped });
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
      qualifies, kpi_actuals, kpi_breakdown,
    } = req.body;

    if (!employee_id)
      return res.status(400).json({ success: false, message: "employee_id required" });

    let calculated_amount      = 0;
    let completion_bonus       = 0;
    let completion_bonus_label = "";
    let resolvedPlanId         = plan_id;

    const actuals = kpi_actuals || kpi_breakdown || [];

    if (plan_id) {
      const plan         = await IncentivePlan.findById(plan_id);
      calculated_amount  = calcAmount(plan, performance_score, salary || 0, qualifies !== false, actuals);
      completion_bonus       = calcCompletionReward(plan, salary || 0, actuals);
      completion_bonus_label = plan?.completion_reward_label || "";
    } else if (assignment_id) {
      const asgn = await IncentiveAssignment.findById(assignment_id).populate("plan_id");
      if (asgn?.plan_id) {
        resolvedPlanId         = asgn.plan_id._id;
        calculated_amount      = calcAmount(asgn.plan_id, performance_score, salary || 0, qualifies !== false, actuals);
        completion_bonus       = calcCompletionReward(asgn.plan_id, salary || 0, actuals);
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
      kpi_breakdown:     actuals,
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

    // If recalculating with new kpi_breakdown, recompute amount on server too
    if (req.body.kpi_breakdown && req.body.performance_score != null) {
      const existing = await IncentiveResult.findById(req.params.id).populate("plan_id");
      if (existing?.plan_id?.plan_type === "kpi_linked") {
        const actuals = req.body.kpi_breakdown || [];
        const base    = calcKpiLinkedAmount(existing.plan_id, req.body.performance_score, existing.salary, actuals);
        const bonus   = calcCompletionReward(existing.plan_id, existing.salary, actuals);
        // Only override if client didn't already send a calculated_amount
        if (req.body.calculated_amount == null) {
          req.body.calculated_amount = base + bonus;
        }
      }
    }

    // Standalone qualifies flag
    if ("qualifies" in req.body) {
      const existing = await IncentiveResult.findById(req.params.id).populate("plan_id");
      if (existing?.plan_id?.plan_type === "standalone") {
        req.body.calculated_amount = calcAmount(existing.plan_id, 0, existing.salary, req.body.qualifies);
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