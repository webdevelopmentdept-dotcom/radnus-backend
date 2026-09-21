const express = require("express");
const router = express.Router();
const Internship = require("../models/Internship");

// GET /api/internship/applications  -> list all (optionally ?status=New)
router.get("/applications", async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const applications = await Internship.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, applications });
  } catch (err) {
    console.error("Error fetching internship applications:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// GET /api/internship/applications/:id -> single record
router.get("/applications/:id", async (req, res) => {
  try {
    const record = await Internship.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, application: record });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// PUT /api/internship/applications/:id/screen -> HR screening step
router.put("/applications/:id/screen", async (req, res) => {
  try {
    const { status, hrRemarks, ratings } = req.body;
    const update = {};
    if (status) update.status = status;
    if (hrRemarks !== undefined) update.hrRemarks = hrRemarks;
    if (ratings) update.ratings = ratings;

    const updated = await Internship.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, application: updated });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// PUT /api/internship/applications/:id/allocate -> project allocation
router.put("/applications/:id/allocate", async (req, res) => {
  try {
    const allocation = req.body; // { department, mentor, projectTitle, businessProblem, expectedDeliverable, startDate, endDate }
    const updated = await Internship.findByIdAndUpdate(
      req.params.id,
      { allocation },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, application: updated });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// PUT /api/internship/applications/:id/progress -> update/add a week's progress
router.put("/applications/:id/progress", async (req, res) => {
  try {
    const { week, status, notes } = req.body;
    const record = await Internship.findById(req.params.id);
    if (!record) return res.status(404).json({ success: false, msg: "Not found" });

    const existingWeek = record.progress.find((p) => p.week === week);
    if (existingWeek) {
      existingWeek.status = status || existingWeek.status;
      existingWeek.notes = notes ?? existingWeek.notes;
      existingWeek.updatedAt = new Date();
    } else {
      record.progress.push({ week, status: status || "Pending", notes: notes || "" });
    }
    await record.save();
    res.json({ success: true, application: record });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// PUT /api/internship/applications/:id/final -> final evaluation & certificate
router.put("/applications/:id/final", async (req, res) => {
  try {
    const finalEvaluation = req.body; // { presentationDone, reportUrl, mentorFeedback, certificateStatus }
    const updated = await Internship.findByIdAndUpdate(
      req.params.id,
      { finalEvaluation },
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, application: updated });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// DELETE /api/internship/applications/:id
router.delete("/applications/:id", async (req, res) => {
  try {
    const deleted = await Internship.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, msg: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;