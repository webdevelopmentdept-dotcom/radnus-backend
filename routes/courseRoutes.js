const express = require("express");
const Course = require("../models/Course");

const router = express.Router();

/* ======================================================
      CREATE COURSE
====================================================== */
router.post("/", async (req, res) => {
  try {
    const course = await Course.create(req.body);
    return res.status(201).json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ======================================================
      GET ALL COURSES (MAIN FIX YOU NEED)
====================================================== */
router.get("/all", async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });

    return res.json({
      success: true,
      total: courses.length,
      courses,
    });
  } catch (err) {
    console.error("COURSE API ERROR:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ======================================================
      GET ALL COURSES (existing)
====================================================== */
router.get("/", async (req, res) => {
  try {
    const courses = await Course.find().sort({ createdAt: -1 });
    return res.json({ success: true, courses });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ======================================================
      GET SINGLE COURSE
====================================================== */
router.get("/:id", async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);
    if (!course)
      return res.status(404).json({ success: false, message: "Not found" });

    return res.json({ success: true, course });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ======================================================
      UPDATE COURSE
====================================================== */
router.put("/:id", async (req, res) => {
  try {
    const updated = await Course.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
    });

    return res.json({ success: true, course: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

/* ======================================================
      DELETE COURSE
====================================================== */
router.delete("/:id", async (req, res) => {
  try {
    await Course.findByIdAndDelete(req.params.id);
    return res.json({ success: true, message: "Course deleted" });
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
