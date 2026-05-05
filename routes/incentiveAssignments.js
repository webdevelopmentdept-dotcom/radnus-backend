// routes/incentiveAssignments.js
const express             = require("express");
const router              = express.Router();
const IncentiveAssignment = require("../models/IncentiveAssignment");
const IncentivePlan       = require("../models/IncentivePlan");
const IncentiveResult     = require("../models/IncentiveResult");
const Employee            = require("../models/Employee");

// ── GET /api/incentive-assignments ───────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.employee_id) filter.employee_id = req.query.employee_id;
    if (req.query.period)      filter.period      = req.query.period;

    const assignments = await IncentiveAssignment.find(filter)
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle period_type slabs plan_type")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: assignments, total: assignments.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/incentive-assignments ──────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { employee_id, plan_id, cycle, period } = req.body;

    if (!employee_id || !plan_id || !period)
      return res.status(400).json({
        success: false,
        message: "employee_id, plan_id & period are required",
      });

    // ── Duplicate assignment check ─────────────────────────────────────────
    const existing = await IncentiveAssignment.findOne({ employee_id, period });
    if (existing)
      return res.status(409).json({
        success: false,
        message: `Employee already has an assignment for period ${period}`,
      });

    // ── Fetch plan & employee ──────────────────────────────────────────────
    const [plan, emp] = await Promise.all([
      IncentivePlan.findById(plan_id),
      Employee.findById(employee_id),
    ]);

    if (!plan)
      return res.status(404).json({ success: false, message: "Incentive plan not found" });
    if (!emp)
      return res.status(404).json({ success: false, message: "Employee not found" });

    // ── Resolve cycle from plan ────────────────────────────────────────────
    const finalCycle = cycle || plan.period_type || plan.cycle || "Monthly";

    // ── Save assignment ────────────────────────────────────────────────────
    const asgn = await new IncentiveAssignment({
      employee_id,
      plan_id,
      cycle: finalCycle,
      period,
    }).save();

    // ── Auto-create a pending IncentiveResult ──────────────────────────────
    const resultExists = await IncentiveResult.findOne({
      employee_id,
      cycle_period: period,
    });

    if (!resultExists) {
      const salary = emp.salary || 0;

      // Pre-calculate amount for standalone plans; KPI plans start at 0
      let calculated_amount = 0;
      if (plan.plan_type === "standalone") {
        calculated_amount =
          plan.standalone_payout_type === "percentage"
            ? Math.round((plan.standalone_payout_value / 100) * salary)
            : Number(plan.standalone_payout_value) || 0;
      }

      await IncentiveResult.create({
        employee_id,
        plan_id,
        assignment_id:          asgn._id,
        performance_score:      0,
        salary,
        calculated_amount,
        completion_bonus:       0,
        completion_bonus_label: "",
        cycle:                  finalCycle,
        cycle_period:           period,
        status:                 "pending",
      });
    }

    // ── Return populated assignment ────────────────────────────────────────
    const populated = await IncentiveAssignment.findById(asgn._id)
      .populate("employee_id", "name email department designation salary")
      .populate("plan_id",     "name department cycle period_type slabs plan_type");

    res.status(201).json({ success: true, data: populated });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: "Duplicate assignment" });
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/incentive-assignments/:id ─────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const asgn = await IncentiveAssignment.findById(req.params.id);
    if (!asgn)
      return res.status(404).json({ success: false, message: "Assignment not found" });

    // ── Also remove the linked pending result (if still pending) ──────────
    await IncentiveResult.deleteOne({
      assignment_id: asgn._id,
      status:        "pending",   // never delete approved/paid results
    });

    await asgn.deleteOne();

    res.json({ success: true, message: "Assignment removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;