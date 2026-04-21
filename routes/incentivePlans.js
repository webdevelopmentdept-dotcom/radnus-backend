// routes/incentivePlans.js
const express      = require("express");
const router       = express.Router();
const IncentivePlan = require("../models/IncentivePlan");

// GET /api/incentive-plans
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.department) filter.department = req.query.department;
    if (req.query.cycle)      filter.cycle      = req.query.cycle;
    const plans = await IncentivePlan.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: plans, total: plans.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/incentive-plans/:id
router.get("/:id", async (req, res) => {
  try {
    const plan = await IncentivePlan.findById(req.params.id);
    if (!plan) return res.status(404).json({ success: false, message: "Plan not found" });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/incentive-plans
router.post("/", async (req, res) => {
  try {
    const { name, department, cycle, slabs } = req.body;
    if (!name || !department) return res.status(400).json({ success: false, message: "name & department required" });
    const plan = new IncentivePlan({ name, department, cycle, slabs });
    await plan.save();
    res.status(201).json({ success: true, data: plan });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/incentive-plans/:id
router.put("/:id", async (req, res) => {
  try {
    const plan = await IncentivePlan.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
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