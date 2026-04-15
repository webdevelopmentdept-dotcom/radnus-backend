// routes/assignGradeRoutes.js — UPDATED with history tracking

const express = require("express");
const router  = express.Router();
const Assign  = require("../models/AssignGrade");
const Grade   = require("../models/gradeModel"); // to fetch grade snapshot

// ── helper: determine change type ──────────────────────────────────────────
const getChangeType = (oldLevel, newLevel) => {
  if (!oldLevel) return "initial";
  const oldNum = parseInt(oldLevel.replace("L", ""));
  const newNum = parseInt(newLevel.replace("L", ""));
  if (newNum > oldNum) return "promote";
  if (newNum < oldNum) return "demote";
  return "lateral";
};

// ── POST /api/assign-grade  →  Create assignment ───────────────────────────
router.post("/", async (req, res) => {
  try {
    const { employee_id, grade_id, effective_date, reason } = req.body;

    if (!employee_id || !grade_id || !effective_date)
      return res.status(400).json({ success: false, message: "All fields are required" });

    // Prevent duplicate active assignment for same employee
    const existing = await Assign.findOne({ employee_id });
    if (existing)
      return res.status(400).json({ success: false, message: "This employee already has a grade assigned. Use Edit to change it." });

    // Fetch grade snapshot for history
    const grade = await Grade.findById(grade_id);

    const historyEntry = {
      grade_id,
      grade_level:       grade?.level       || "",
      grade_designation: grade?.designation || "",
      bgr_stage:         grade?.bgr_stage   || "",
      effective_date,
      change_type: "initial",
      reason: reason || "Initial grade assignment",
    };

    const data = await Assign.create({
      employee_id,
      grade_id,
      effective_date,
      grade_history: [historyEntry],
    });

    const populated = await Assign.findById(data._id)
      .populate("employee_id", "name employee_id department designation")
      .populate("grade_id", "level designation bgr_stage experience_range core_responsibility performance_expectation salary_band_min salary_band_max");

    res.json({ success: true, message: "Grade assigned successfully", data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/assign-grade  →  All assignments ──────────────────────────────
router.get("/", async (req, res) => {
  try {
    const data = await Assign.find()
      .populate("employee_id", "name employee_id department designation")
      .populate("grade_id", "level designation bgr_stage experience_range core_responsibility performance_expectation salary_band_min salary_band_max")
      .populate("grade_history.grade_id", "level designation bgr_stage")
      .sort({ createdAt: -1 });

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/assign-grade/employee/:employeeId  →  Get by employee ─────────
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const data = await Assign.findOne({ employee_id: req.params.employeeId })
      .populate("grade_id", "level designation bgr_stage experience_range core_responsibility performance_expectation salary_band_min salary_band_max")
      .populate("grade_history.grade_id", "level designation bgr_stage");

    res.json({ success: true, data: data || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/assign-grade/:id  →  Single assignment ───────────────────────
router.get("/:id", async (req, res) => {
  try {
    const data = await Assign.findById(req.params.id)
      .populate("employee_id", "name employee_id department designation")
      .populate("grade_id")
      .populate("grade_history.grade_id", "level designation bgr_stage");

    if (!data) return res.status(404).json({ success: false, message: "Assignment not found" });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/assign-grade/:id  →  Update (grade change = history entry) ───
router.put("/:id", async (req, res) => {
  try {
    const { employee_id, grade_id, effective_date, reason } = req.body;

    if (!employee_id || !grade_id || !effective_date)
      return res.status(400).json({ success: false, message: "All fields are required" });

    const existing = await Assign.findById(req.params.id)
      .populate("grade_id", "level designation bgr_stage");

    if (!existing) return res.status(404).json({ success: false, message: "Assignment not found" });

    const oldLevel = existing.grade_id?.level || "";
    const newGrade = await Grade.findById(grade_id);
    const newLevel = newGrade?.level || "";

    // Only add history if grade actually changed
    if (String(existing.grade_id?._id) !== String(grade_id)) {
      const changeType = getChangeType(oldLevel, newLevel);

      const historyEntry = {
        grade_id,
        grade_level:       newGrade?.level       || newLevel,
        grade_designation: newGrade?.designation || "",
        bgr_stage:         newGrade?.bgr_stage   || "",
        effective_date,
        change_type: changeType,
        reason: reason || `Grade changed from ${oldLevel} to ${newLevel}`,
      };

      existing.grade_history.push(historyEntry);
    }

    existing.grade_id       = grade_id;
    existing.effective_date = effective_date;
    if (employee_id) existing.employee_id = employee_id;

    await existing.save();

    const updated = await Assign.findById(req.params.id)
      .populate("employee_id", "name employee_id department designation")
      .populate("grade_id", "level designation bgr_stage experience_range core_responsibility performance_expectation salary_band_min salary_band_max")
      .populate("grade_history.grade_id", "level designation bgr_stage");

    res.json({ success: true, message: "Assignment updated successfully", data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/assign-grade/:id  →  Remove assignment ────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Assign.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Assignment not found" });
    res.json({ success: true, message: "Assignment removed successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;