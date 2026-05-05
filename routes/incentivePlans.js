// routes/incentivePlans.js
const express       = require("express");
const router        = express.Router();
const IncentivePlan = require("../models/IncentivePlan");

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildPeriodFields(body) {
  const { period_type, period_month, period_quarter, period_half, period_year } = body;
  return {
    period_type:    period_type    || "Monthly",
    period_month:   period_month   || null,
    period_quarter: period_quarter || null,
    period_half:    period_half    || null,
    period_year:    period_year    || new Date().getFullYear(),
  };
}

function buildKpiFields(body) {
  const { kpi_template_id, kpi_configs,
          completion_reward_type, completion_reward_value, completion_reward_label } = body;
  return {
    kpi_template_id:         kpi_template_id  || null,
    kpi_configs:             kpi_configs       || [],
    completion_reward_type:  completion_reward_type  || "none",
    completion_reward_value: completion_reward_value || 0,
    completion_reward_label: completion_reward_label || "",
  };
}

function buildStandaloneFields(body) {
  const { standalone_metric, standalone_metric_label,
          standalone_payout_type, standalone_payout_value, slabs } = body;
  return {
    standalone_metric:       standalone_metric       || "manual",
    standalone_metric_label: standalone_metric_label || "",
    standalone_payout_type:  standalone_payout_type  || "fixed",
    standalone_payout_value: standalone_payout_value || 0,
    slabs:                   slabs                   || [],
  };
}

// ── GET /api/incentive-plans ─────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.department)   filter.department   = req.query.department;
    if (req.query.period_type)  filter.period_type  = req.query.period_type;
    if (req.query.period_year)  filter.period_year  = Number(req.query.period_year);

    const plans = await IncentivePlan.find(filter)
      .populate("kpi_template_id", "template_name role kpi_items")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: plans, total: plans.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/incentive-plans/:id ─────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const plan = await IncentivePlan.findById(req.params.id)
      .populate("kpi_template_id", "template_name role kpi_items");
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/incentive-plans ────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { name, department, plan_type } = req.body;

    if (!name || !department)
      return res.status(400).json({ success: false, message: "name & department are required" });

    const isKpi = plan_type === "kpi_linked";

    if (isKpi && (!req.body.kpi_configs || req.body.kpi_configs.length === 0))
      return res.status(400).json({ success: false, message: "At least one KPI must be configured" });

    const plan = new IncentivePlan({
      name,
      department,
      plan_type: plan_type || "kpi_linked",
      ...buildPeriodFields(req.body),
      ...(isKpi  ? buildKpiFields(req.body)        : {}),
      ...(!isKpi ? buildStandaloneFields(req.body) : {}),
    });

    await plan.save();
    await plan.populate("kpi_template_id", "template_name role kpi_items");
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── PUT /api/incentive-plans/:id ─────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const { name, department, plan_type } = req.body;
    const isKpi = plan_type === "kpi_linked";

    const updateData = {
      name,
      department,
      plan_type: plan_type || "kpi_linked",
      ...buildPeriodFields(req.body),
      ...(isKpi  ? buildKpiFields(req.body)        : { kpi_template_id: null, kpi_configs: [], completion_reward_type: "none", completion_reward_value: 0 }),
      ...(!isKpi ? buildStandaloneFields(req.body) : { standalone_metric: null, standalone_metric_label: null, standalone_payout_type: null, standalone_payout_value: null, slabs: [] }),
    };

    const plan = await IncentivePlan.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    ).populate("kpi_template_id", "template_name role kpi_items");

    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/incentive-plans/:id ─────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const plan = await IncentivePlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, message: "Plan deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;