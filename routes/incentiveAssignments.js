// routes/incentiveAssignments.js
const express             = require("express");
const router              = express.Router();
const IncentiveAssignment = require("../models/IncentiveAssignment");
const IncentivePlan       = require("../models/IncentivePlan");

// GET /api/incentive-assignments
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.employee_id) filter.employee_id = req.query.employee_id;
    if (req.query.period)      filter.period      = req.query.period;
    const assignments = await IncentiveAssignment.find(filter)
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: assignments, total: assignments.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/incentive-assignments
router.post("/", async (req, res) => {
  try {
    const { employee_id, plan_id, cycle, period } = req.body;
    if (!employee_id || !plan_id || !period)
      return res.status(400).json({ success: false, message: "employee_id, plan_id & period required" });

    // Duplicate check
    const existing = await IncentiveAssignment.findOne({ employee_id, period });
    if (existing) return res.status(409).json({ success: false, message: `Already assigned for period ${period}` });

    // Auto-fill cycle from plan
    let finalCycle = cycle;
    if (!finalCycle) {
      const plan = await IncentivePlan.findById(plan_id);
      finalCycle = plan?.cycle || "Monthly";
    }

    const asgn = new IncentiveAssignment({ employee_id, plan_id, cycle: finalCycle, period });
    await asgn.save();

    const populated = await IncentiveAssignment.findById(asgn._id)
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle slabs");

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: "Duplicate assignment" });
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/incentive-assignments/:id
router.delete("/:id", async (req, res) => {
  try {
    const asgn = await IncentiveAssignment.findByIdAndDelete(req.params.id);
    if (!asgn) return res.status(404).json({ success: false, message: "Assignment not found" });
    res.json({ success: true, message: "Removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;