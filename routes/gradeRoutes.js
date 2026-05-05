const express = require("express");
const router  = express.Router();
const Grade   = require("../models/gradeModel");

// ─── Default L1–L10 Grades (from SOP 3.3) ────────────────────────────────────
const DEFAULT_GRADES = [
  { level: "L1",  designation: "Executive",                    experience_range: "0–2 Years",   core_responsibility: "Execute assigned operational tasks with accuracy",         performance_expectation: "Complete task ownership & learning agility",       bgr_stage: "Build"  },
  { level: "L2",  designation: "Senior Executive",             experience_range: "2–4 Years",   core_responsibility: "Support team leaders; handle independent tasks",          performance_expectation: "Quality performance with minimal supervision",      bgr_stage: "Build"  },
  { level: "L3",  designation: "Assistant Manager (AM)",       experience_range: "3–6 Years",   core_responsibility: "Manage small teams; assist in process improvement",       performance_expectation: "Consistent delivery & basic leadership",            bgr_stage: "Build"  },
  { level: "L4",  designation: "Manager (M)",                  experience_range: "5–8 Years",   core_responsibility: "Lead department/team; drive KPIs",                        performance_expectation: "Achieve departmental goals & mentor juniors",       bgr_stage: "Grow"   },
  { level: "L5",  designation: "Senior Manager (Sr. M)",       experience_range: "7–10 Years",  core_responsibility: "Manage multiple teams; oversee strategy execution",        performance_expectation: "Strategic alignment & operational efficiency",      bgr_stage: "Grow"   },
  { level: "L6",  designation: "General Manager (GM)",         experience_range: "10–13 Years", core_responsibility: "Oversee business units; cross-functional collaboration",   performance_expectation: "Business growth & cross-department synergy",        bgr_stage: "Grow"   },
  { level: "L7",  designation: "Associate Vice President (AVP)",experience_range: "12–15 Years", core_responsibility: "Lead multiple functions; strategic initiatives",          performance_expectation: "Innovation & leadership excellence",                bgr_stage: "Grow"   },
  { level: "L8",  designation: "Vice President (VP)",          experience_range: "14–18 Years", core_responsibility: "Define business strategies; lead key verticals",           performance_expectation: "Long-term value creation & transformation",         bgr_stage: "Retain" },
  { level: "L9",  designation: "Director",                     experience_range: "18–22 Years", core_responsibility: "Drive company-wide policies and major decisions",          performance_expectation: "Organizational leadership & governance",            bgr_stage: "Retain" },
  { level: "L10", designation: "CXO (C-Level Executives)",     experience_range: "20+ Years",   core_responsibility: "Shape corporate vision, strategy, and culture",            performance_expectation: "Visionary leadership & sustainable growth",         bgr_stage: "Retain" },
];

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/grade-master  →  Get all grades (sorted by level)
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const grades = await Grade.find({ is_active: true }).sort({ level: 1 });
    res.json({ success: true, data: grades });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch grades", error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/grade-master/:id  →  Get single grade
// ─────────────────────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const grade = await Grade.findById(req.params.id);
    if (!grade) return res.status(404).json({ success: false, message: "Grade not found" });
    res.json({ success: true, data: grade });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to fetch grade", error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/grade-master  →  Create new grade
// ─────────────────────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { level, designation, experience_range, core_responsibility, performance_expectation, bgr_stage, salary_band_min, salary_band_mid, salary_band_max, notes } = req.body;

    if (!level || !designation || !experience_range || !bgr_stage)
      return res.status(400).json({ success: false, message: "Level, Designation, Experience Range and BGR Stage are required" });

    // Check duplicate level
    const existing = await Grade.findOne({ level: level.toUpperCase() });
    if (existing) return res.status(400).json({ success: false, message: `Grade ${level.toUpperCase()} already exists` });

    const grade = await Grade.create({
      level: level.toUpperCase(),
      designation,
      experience_range,
      core_responsibility: core_responsibility || "",
      performance_expectation: performance_expectation || "",
      bgr_stage,
      salary_band_min: salary_band_min || null,
      salary_band_mid: salary_band_mid || null,
      salary_band_max: salary_band_max || null,
      notes: notes || "",
    });

    res.status(201).json({ success: true, message: "Grade created successfully", data: grade });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to create grade", error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/grade-master/:id  →  Update grade
// ─────────────────────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
const { level, designation, experience_range, core_responsibility, performance_expectation, bgr_stage, salary_band_min, salary_band_mid, salary_band_max, notes } = req.body;
    if (!level || !designation || !experience_range || !bgr_stage)
      return res.status(400).json({ success: false, message: "Level, Designation, Experience Range and BGR Stage are required" });

    // Check duplicate level (exclude current doc)
    const existing = await Grade.findOne({ level: level.toUpperCase(), _id: { $ne: req.params.id } });
    if (existing) return res.status(400).json({ success: false, message: `Grade ${level.toUpperCase()} already exists` });

    const updated = await Grade.findByIdAndUpdate(
      req.params.id,
      {
        level: level.toUpperCase(),
        designation,
        experience_range,
        core_responsibility: core_responsibility || "",
        performance_expectation: performance_expectation || "",
        bgr_stage,
        salary_band_min: salary_band_min || null,
        salary_band_mid: salary_band_mid || null,
        salary_band_max: salary_band_max || null,
        notes: notes || "",
      },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ success: false, message: "Grade not found" });

    res.json({ success: true, message: "Grade updated successfully", data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to update grade", error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/grade-master/:id  →  Soft delete grade
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Grade.findByIdAndUpdate(
      req.params.id,
      { is_active: false },
      { new: true }
    );
    if (!deleted) return res.status(404).json({ success: false, message: "Grade not found" });
    res.json({ success: true, message: "Grade deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to delete grade", error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/grade-master/seed-defaults  →  Seed L1–L10 default grades
// ─────────────────────────────────────────────────────────────────────────────
router.post("/seed-defaults", async (req, res) => {
  try {
    const results = { created: 0, skipped: 0 };

    for (const g of DEFAULT_GRADES) {
      const exists = await Grade.findOne({ level: g.level });
      if (exists) {
        results.skipped++;
        continue;
      }
      await Grade.create(g);
      results.created++;
    }

    res.json({
      success: true,
      message: `Seeded successfully! Created: ${results.created}, Skipped (already exist): ${results.skipped}`,
      data: results,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Seed failed", error: err.message });
  }
});

module.exports = router;