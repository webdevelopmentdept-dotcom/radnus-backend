// routes/incentiveResults.js
const express             = require("express");
const router              = express.Router();
const IncentiveResult     = require("../models/IncentiveResult");
const IncentivePlan       = require("../models/IncentivePlan");
const IncentiveAssignment = require("../models/IncentiveAssignment");
const { createNotification } = require("../helpers/notificationHelper");

// ── Shared populate fields ────────────────────────────────────────────────────
const PLAN_FIELDS = [
  "name", "description", "department", "cycle", "slabs", "plan_type",
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

// ══════════════════════════════════════════════════════════════════════════
// Rule: period ends → +1 day grace → locked from the day AFTER the grace day.
// (e.g. Aug period: Aug 31 last day, Sep 1 grace day, Sep 2 onwards = locked)
// ══════════════════════════════════════════════════════════════════════════
function getPeriodLockDate(cycle_period) {
  if (!cycle_period) return null;
  let nextPeriodStart = null;

  let m = cycle_period.match(/^(\d{4})-(\d{2})$/);              // Monthly "2026-08"
  if (m) nextPeriodStart = new Date(Number(m[1]), Number(m[2]), 1);

  if (!nextPeriodStart) {
    m = cycle_period.match(/^(\d{4})-Q([1-4])$/);               // Quarterly "2026-Q1"
    if (m) nextPeriodStart = new Date(Number(m[1]), Number(m[2]) * 3, 1);
  }
  if (!nextPeriodStart) {
    m = cycle_period.match(/^(\d{4})-H([1-2])$/);               // Half-Yearly "2026-H1"
    if (m) nextPeriodStart = new Date(Number(m[1]), Number(m[2]) * 6, 1);
  }
  if (!nextPeriodStart) {
    m = cycle_period.match(/^(\d{4})$/);                        // Yearly "2026"
    if (m) nextPeriodStart = new Date(Number(m[1]) + 1, 0, 1);
  }
  if (!nextPeriodStart) return null;

  return new Date(nextPeriodStart.getTime() + 24 * 60 * 60 * 1000); // +1 day grace
}

function isPeriodLocked(cycle_period) {
  const lockDate = getPeriodLockDate(cycle_period);
  if (!lockDate) return false;
  return new Date() >= lockDate;
}

// 🆕 Each entry's amount is matched against slabs INDEPENDENTLY, then summed.
// (e.g. Entry1 ₹1,53,000 → ₹2,000 slab | Entry2 ₹2,60,000 → ₹6,000 slab | Total = ₹8,000)
function calcEntriesPayout(plan, entries = [], salary = 0) {
  if (!plan?.resolveStandalonePayout) return { total: 0, breakdown: [] };
  let total = 0;
  const breakdown = entries.map(e => {
    const amt = plan.resolveStandalonePayout(Number(e.amount) || 0, salary);
    total += amt;
    return { entry_id: e._id, amount: e.amount, payout: amt };
  });
  return { total, breakdown };
}

// Recompute total from sale_entries + freeze amount once the period locks.
// Safe to call repeatedly — only writes when something actually changes.
async function syncResultState(result, plan) {
  if (!result || !plan || plan.plan_type !== "standalone") return result;

  const entries = result.sale_entries || [];
  const total   = entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  let changed = false;

  if (result.employee_submitted_value !== total) {
    result.employee_submitted_value = total;
    changed = true;
  }

  const locked = isPeriodLocked(result.cycle_period);

  if (locked && !result.period_locked) {
    result.period_locked    = true;
    result.period_locked_at = new Date();
    changed = true;
  }

  if (locked) {
    // 🆕 Per-entry slab match, summed — not cumulative-total match
    const { total: amount } = calcEntriesPayout(plan, entries, result.salary || 0);
    if (result.calculated_amount !== amount) {
      result.calculated_amount = amount;
      changed = true;
    }
    if (!result.hr_review_requested) {
      result.hr_review_requested    = true;
      result.hr_review_requested_at = new Date();
      changed = true;
    }
  }

  if (changed) await result.save();
  return result;
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
// router.get("/employee/:employeeId", async (req, res) => {
//   try {
//     const results = await IncentiveResult.find({ employee_id: req.params.employeeId })
//       .populate("plan_id", PLAN_FIELDS)
//       .populate("employee_id", EMP_FIELDS)
//       .sort({ createdAt: -1 });

//     res.json({ success: true, data: results });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

router.get("/employee/:empId", async (req, res) => {
  try {
    const results = await IncentiveResult.find({ employee_id: req.params.empId })
      .populate({
        path: "plan_id",
        select: "name description plan_type period_type standalone_slabs standalone_payout_type standalone_payout_value standalone_metric standalone_metric_label standalone_target_type kpi_configs completion_reward_type completion_reward_value completion_reward_label"
      })
      .sort({ createdAt: -1 });

    // 🆕 Sync lock/total state for standalone pending results before returning
    for (const r of results) {
      if (r.plan_id?.plan_type === "standalone" && r.status === "pending") {
        await syncResultState(r, r.plan_id);
      }
    }

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
      const plan = asgn.plan_snapshot?.plan_type
        ? { ...asgn.plan_id.toObject(), ...asgn.plan_snapshot }
        : asgn.plan_id;

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

// ── GET /api/incentive-results/pending-reviews ───────────────────────────────
router.get("/pending-reviews", async (req, res) => {
  try {
    // 🆕 First, catch any standalone results whose period just locked
    // (nobody opened the app to trigger the sync yet) and flip them ready.
    const dueCheck = await IncentiveResult.find({
      status: "pending",
      hr_review_requested: false,
      period_locked: false,
    }).populate({ path: "plan_id", select: "plan_type standalone_slabs" });

    for (const r of dueCheck) {
      if (r.plan_id?.plan_type === "standalone") await syncResultState(r, r.plan_id);
    }

    const results = await IncentiveResult.find({
      hr_review_requested: true,
      status: "pending"
    })
      .populate("employee_id", "name department designation salary")
      .populate({
        path: "plan_id",
        select: "name plan_type standalone_slabs standalone_target_type standalone_payout_type standalone_payout_value"
      })
      .sort({ hr_review_requested_at: -1 });

    res.json({ success: true, data: results });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
})

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
        resolvedPlanId = asgn.plan_id._id;
        // 🆕 இந்த 3 lines add பண்ணு
        const planData = asgn.plan_snapshot?.plan_type
          ? { ...asgn.plan_id.toObject(), ...asgn.plan_snapshot }
          : asgn.plan_id;
        // 🆕 asgn.plan_id → planData மாத்தணும் கீழே
        calculated_amount      = calcAmount(planData, performance_score, salary || 0, qualifies !== false, actuals);
        completion_bonus       = calcCompletionReward(planData, salary || 0, actuals);
        completion_bonus_label = planData?.completion_reward_label || "";
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
      const existing = await IncentiveResult.findById(req.params.id)
        .populate("plan_id")
        .populate("assignment_id"); // 🆕 இந்த line add பண்ணு
      // 🆕 இந்த 3 lines add பண்ணு
      const asnp = existing.assignment_id;
      const planData = asnp?.plan_snapshot?.plan_type
        ? { ...existing.plan_id.toObject(), ...asnp.plan_snapshot }
        : existing.plan_id;
      // 🆕 existing.plan_id → planData மாத்தணும் கீழே
      if (planData?.plan_type === "kpi_linked") {
        const actuals = req.body.kpi_breakdown || [];
        const base    = calcKpiLinkedAmount(planData, req.body.performance_score, existing.salary, actuals);
        const bonus   = calcCompletionReward(planData, existing.salary, actuals);
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

    // 🆕 Notify employee — marked paid
    if (req.body.status === "paid") {
      await createNotification({
        recipient_id:   result.employee_id?._id || result.employee_id,
        recipient_role: "employee",
        type:           "incentive_paid",
        title:          "Incentive Paid 💸",
        message:        `₹${(result.calculated_amount || 0).toLocaleString("en-IN")} for ${result.cycle_period} has been credited.`,
        link:           "/employee/my-incentive",
      });
    }

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});


// ── POST /api/incentive-results/:id/request-review ──────────────────────────
router.post("/:id/request-review", async (req, res) => {
  try {
    const { achieved_value, note, selected_slab } = req.body;
    const result = await IncentiveResult.findById(req.params.id);
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });
    if (result.hr_review_requested)
      return res.status(409).json({ success: false, message: "Review already requested" });

    const val = Number(achieved_value) || 0;

    // 🆕 Auto-calculate amount from the selected slab (supports per_unit, fixed, %)
    if (selected_slab && selected_slab.payout_type) {
      let amount = 0;
      switch (selected_slab.payout_type) {
        case "fixed":
          amount = Number(selected_slab.payout_value) || 0;
          break;
        case "per_unit":
          amount = Math.round(val * (Number(selected_slab.payout_value) || 0));
          break;
        case "percent_of_achieved":
          amount = Math.round(((Number(selected_slab.payout_value) || 0) / 100) * val);
          break;
        case "percent_of_salary":
          amount = Math.round(((Number(selected_slab.payout_value) || 0) / 100) * (result.salary || 0));
          break;
        default:
          amount = 0;
      }
      result.calculated_amount = amount;
    }

    result.hr_review_requested     = true;
    result.hr_review_requested_at  = new Date();
    result.hr_review_note          = note || "";
    result.employee_submitted_value = val;
    await result.save();

    res.json({ success: true, message: "Review request sent to HR", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ══════════════════════════════════════════════════════════════════════════
// 🆕 OPTION C — Cumulative sale entry routes
// ══════════════════════════════════════════════════════════════════════════

// ── POST /api/incentive-results/:id/add-entry  (Employee — blocked once locked) ──
router.post("/:id/add-entry", async (req, res) => {
  try {
    const { amount, date, note } = req.body;
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ success: false, message: "Valid amount is required" });

    const result = await IncentiveResult.findById(req.params.id).populate("plan_id");
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    const plan = result.plan_id;
    if (!plan || plan.plan_type !== "standalone")
      return res.status(400).json({ success: false, message: "Entries only apply to standalone plans" });

    if (isPeriodLocked(result.cycle_period))
      return res.status(409).json({ success: false, message: "This period is locked. Contact HR to add/correct entries." });

    result.sale_entries.push({
      amount:   Number(amount),
      date:     date ? new Date(date) : new Date(),
      note:     note || "",
      added_by: "employee",
      added_at: new Date(),
    });

    await syncResultState(result, plan);

    res.json({ success: true, message: "Entry added ✅", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/incentive-results/:id/entries  (running total + slab preview) ──
router.get("/:id/entries", async (req, res) => {
  try {
    const result = await IncentiveResult.findById(req.params.id).populate("plan_id");
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    const plan = result.plan_id;
    if (plan?.plan_type === "standalone") await syncResultState(result, plan);

    const total = result.employee_submitted_value;
    const slabs = plan?.standalone_slabs || [];

    // 🆕 Each entry gets its OWN matched slab + payout
    const entriesWithSlab = (result.sale_entries || []).map(e => {
      const amt = Number(e.amount) || 0;
      const matched = slabs.find(s => {
        const min = Number(s.min_target), max = Number(s.max_target);
        return max === 0 ? amt >= min : (amt >= min && amt <= max);
      });
      const payout = plan?.resolveStandalonePayout ? plan.resolveStandalonePayout(amt, result.salary || 0) : 0;
      return {
        _id: e._id, amount: e.amount, date: e.date, note: e.note, added_by: e.added_by,
        matched_slab: matched || null,
        payout,
      };
    });

    const estimated_amount = result.period_locked
      ? result.calculated_amount
      : entriesWithSlab.reduce((s, e) => s + e.payout, 0);

    res.json({
      success: true,
      data: {
        entries:          entriesWithSlab,
        total_achieved:   total,
        estimated_amount,
        period_locked:    result.period_locked,
        lock_date:        getPeriodLockDate(result.cycle_period),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/incentive-results/:id/hr-entry  (HR add/correct — bypasses lock) ──
router.post("/:id/hr-entry", async (req, res) => {
  try {
    const { amount, date, note } = req.body;
    if (!amount || Number(amount) <= 0)
      return res.status(400).json({ success: false, message: "Valid amount is required" });

    const result = await IncentiveResult.findById(req.params.id).populate("plan_id");
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    const plan = result.plan_id;

    result.sale_entries.push({
      amount:   Number(amount),
      date:     date ? new Date(date) : new Date(),
      note:     note || "",
      added_by: "hr",
      added_at: new Date(),
    });

    const total = result.sale_entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    result.employee_submitted_value = total;
    if (plan) {
      result.calculated_amount = calcEntriesPayout(plan, result.sale_entries, result.salary || 0).total;
    }

    await result.save();
    res.json({ success: true, message: "HR entry added ✅", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/incentive-results/:id/entries/:entryId ──────────────────────
// ?by=hr → bypasses lock (HR correction). Without it → employee call, blocked once submitted.
router.delete("/:id/entries/:entryId", async (req, res) => {
  try {
    const result = await IncentiveResult.findById(req.params.id).populate("plan_id");
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    const isHr = req.query.by === "hr";
    if (!isHr && result.period_locked)
      return res.status(409).json({ success: false, message: "Already submitted. Contact HR to correct entries." });

    const plan = result.plan_id;
    result.sale_entries = result.sale_entries.filter(e => String(e._id) !== req.params.entryId);

    const total = result.sale_entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    result.employee_submitted_value = total;
    if (plan) {
      result.calculated_amount = calcEntriesPayout(plan, result.sale_entries, result.salary || 0).total;
    }

    await result.save();
    res.json({ success: true, message: "Entry removed ✅", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/incentive-results/:id/entries/:entryId  (Employee edit — blocked once submitted) ──
router.put("/:id/entries/:entryId", async (req, res) => {
  try {
    const { amount, note } = req.body;
    const result = await IncentiveResult.findById(req.params.id).populate("plan_id");
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    if (result.period_locked)
      return res.status(409).json({ success: false, message: "Already submitted. Contact HR to edit entries." });

    const entry = result.sale_entries.id(req.params.entryId);
    if (!entry)
      return res.status(404).json({ success: false, message: "Entry not found" });

    if (amount != null && Number(amount) > 0) entry.amount = Number(amount);
    if (note != null) entry.note = note;

    const plan  = result.plan_id;
    const total = result.sale_entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    result.employee_submitted_value = total;
    if (plan) {
      result.calculated_amount = calcEntriesPayout(plan, result.sale_entries, result.salary || 0).total;
    }

    await result.save();
    res.json({ success: true, message: "Entry updated ✅", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/incentive-results/:id/final-submit  (Employee — manual lock, no need to wait for period end) ──
router.post("/:id/final-submit", async (req, res) => {
  try {
    const result = await IncentiveResult.findById(req.params.id).populate("plan_id");
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    const plan = result.plan_id;
    if (!plan || plan.plan_type !== "standalone")
      return res.status(400).json({ success: false, message: "Only applicable to standalone plans" });

    if (result.period_locked)
      return res.status(409).json({ success: false, message: "Already submitted" });

    if (!result.sale_entries || result.sale_entries.length === 0)
      return res.status(400).json({ success: false, message: "Add at least one entry before submitting" });

    const total = result.sale_entries.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    result.employee_submitted_value = total;
    result.period_locked    = true;
    result.period_locked_at = new Date();
    // 🆕 Per-entry slab match, summed
    result.calculated_amount = calcEntriesPayout(plan, result.sale_entries, result.salary || 0).total;
    result.hr_review_requested    = true;
    result.hr_review_requested_at = new Date();

    await result.save();

    // 🆕 Notify HR — employee submitted incentive for review
    const populatedForNotif = await IncentiveResult.findById(result._id).populate("employee_id", "name department");
    await createNotification({
      recipient_id:   "hr_admin_001",
      recipient_role: "hr",
      type:           "incentive_review",
      title:          `Incentive Review — ${populatedForNotif.employee_id?.name || "Employee"} 💰`,
      message:        `${populatedForNotif.employee_id?.name || "An employee"} submitted ${total.toLocaleString("en-IN")} for ${result.cycle_period}. Please review.`,
      link:           "/hr/dashboard/incentives/results",
    });

    res.json({ success: true, message: "Submitted for HR review ✅", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});



// ── POST /api/incentive-results/:id/hr-approve ───────────────────────────────
router.post("/:id/hr-approve", async (req, res) => {
  try {
    const { calculated_amount, remark } = req.body;
    const result = await IncentiveResult.findById(req.params.id);
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    result.calculated_amount = Number(calculated_amount) || 0;
    result.status            = "approved";
    result.hr_review_remark  = remark || "";
    await result.save();

    // 🆕 Notify employee — approved
    await createNotification({
      recipient_id:   result.employee_id,
      recipient_role: "employee",
      type:           "incentive_approved",
      title:          "Incentive Approved ✅",
      message:        `Your incentive of ₹${result.calculated_amount.toLocaleString("en-IN")} for ${result.cycle_period} has been approved.`
                     + (remark ? ` HR note: ${remark}` : ""),
      link:           "/employee/my-incentive",
    });

    res.json({ success: true, message: "Approved ✅", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/incentive-results/:id/hr-reject ────────────────────────────────
router.post("/:id/hr-reject", async (req, res) => {
  try {
    const { remark } = req.body;
    const result = await IncentiveResult.findById(req.params.id);
    if (!result)
      return res.status(404).json({ success: false, message: "Result not found" });

    result.hr_review_requested = false;
    result.hr_review_remark    = remark || "";
    result.status              = "pending";
    await result.save();

    // 🆕 Notify employee — rejected
    await createNotification({
      recipient_id:   result.employee_id,
      recipient_role: "employee",
      type:           "incentive_rejected",
      title:          "Incentive Submission Rejected ❌",
      message:        `Your incentive submission for ${result.cycle_period} was rejected.`
                     + (remark ? ` HR note: ${remark}` : "") + " Please review and re-submit.",
      link:           "/employee/my-incentive",
    });

    res.json({ success: true, message: "Rejected", data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
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