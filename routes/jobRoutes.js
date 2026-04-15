const express = require("express");
const router = express.Router();
const Job = require("../models/Job");

// Public — active jobs only (careers page)
router.get("/public", async (req, res) => {
  try {
    const jobs = await Job.find({ status: "active" }).sort({ posted: -1 });
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// HR — all jobs
router.get("/", async (req, res) => {
  try {
    const jobs = await Job.find().sort({ posted: -1 });
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Create job
router.post("/", async (req, res) => {
  try {
    const job = new Job(req.body);
    await job.save();
    res.json({ success: true, msg: "Job created!", job });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Update job (edit + status change)
router.put("/:id", async (req, res) => {
  try {
    const updated = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, msg: "Job updated!", job: updated });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Delete job
router.delete("/:id", async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ success: true, msg: "Job deleted!" });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;