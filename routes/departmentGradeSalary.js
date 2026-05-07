// routes/departmentGradeSalary.js
const express = require("express");
const router  = express.Router();
const DGS     = require("../models/DepartmentGradeSalary");

// GET all — optionally filter by dept: ?department_id=xxx
// routes/departmentGradeSalary.js — GET route மட்டும் மாத்து

router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.department_id) filter.department_id = req.query.department_id;
    if (req.query.grade_id)      filter.grade_id      = req.query.grade_id;

    // ← populate நீக்கி plain find மட்டும்
    const data = await DGS.find(filter)
      .sort({ grade_level: 1 })
      .lean();

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST — create
router.post("/", async (req, res) => {
  try {
    const doc = await DGS.create(req.body);
    res.json({ success: true, data: doc });
  } catch (err) {
    // Handle duplicate dept+grade
    if (err.code === 11000) {
      return res.status(400).json({ 
        success: false, 
        message: "Salary band already exists for this dept + grade. Edit it instead." 
      });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT — update
router.put("/:id", async (req, res) => {
  try {
    const doc = await DGS.findByIdAndUpdate(
      req.params.id, req.body, { new: true }
    );
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    await DGS.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;