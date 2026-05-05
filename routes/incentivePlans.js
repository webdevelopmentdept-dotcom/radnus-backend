// routes/incentivePlans.js
const express       = require("express");
const router        = express.Router();
const IncentivePlan = require("../models/IncentivePlan");

// GET /api/incentive-plans
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.department) filter.department = req.query.department;
    if (req.query.cycle)      filter.cycle      = req.query.cycle;

    const plans = await IncentivePlan.find(filter)
      .populate("kpi_template_id", "template_name role kpi_items")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: plans, total: plans.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/incentive-plans/:id
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

// POST /api/incentive-plans  ✅ FIXED — saves plan_type + all fields
router.post("/", async (req, res) => {
  try {
    const {
      name, department, cycle,
      plan_type,
      kpi_template_id, slabs,
      standalone_metric, standalone_metric_label,
      standalone_payout_type, standalone_payout_value,
    } = req.body;

    if (!name || !department)
      return res.status(400).json({ success: false, message: "name & department required" });

    const isKpi = plan_type === "kpi_linked";

    const plan = new IncentivePlan({
      name,
      department,
      cycle,
      plan_type: plan_type || "kpi_linked",

      // KPI-Linked fields
      kpi_template_id: isKpi ? (kpi_template_id || null) : null,
      slabs:           isKpi ? (slabs || []) : [],

      // Standalone fields
      standalone_metric:       !isKpi ? (standalone_metric       || "manual") : undefined,
      standalone_metric_label: !isKpi ? (standalone_metric_label || "")       : undefined,
      standalone_payout_type:  !isKpi ? (standalone_payout_type  || "fixed")  : undefined,
      standalone_payout_value: !isKpi ? (standalone_payout_value || 0)        : undefined,
    });

    await plan.save();
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/incentive-plans/:id  ✅ FIXED — updates plan_type + all fields
router.put("/:id", async (req, res) => {
  try {
    const {
      plan_type,
      kpi_template_id, slabs,
      standalone_metric, standalone_metric_label,
      standalone_payout_type, standalone_payout_value,
      ...rest
    } = req.body;

    const isKpi = plan_type === "kpi_linked";

    const updateData = {
      ...rest,
      plan_type: plan_type || "kpi_linked",

      // KPI-Linked fields
      kpi_template_id: isKpi ? (kpi_template_id || null) : null,
      slabs:           isKpi ? (slabs || []) : [],

      // Standalone fields
      standalone_metric:       !isKpi ? (standalone_metric       || "manual") : null,
      standalone_metric_label: !isKpi ? (standalone_metric_label || "")       : null,
      standalone_payout_type:  !isKpi ? (standalone_payout_type  || "fixed")  : null,
      standalone_payout_value: !isKpi ? (standalone_payout_value || 0)        : null,
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

// DELETE /api/incentive-plans/:id
router.delete("/:id", async (req, res) => {
  try {
    const plan = await IncentivePlan.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, message: "Plan deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;