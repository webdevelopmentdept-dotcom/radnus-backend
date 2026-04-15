// routes/feedbackCycle.routes.js

const express = require("express");
const router = express.Router();
const FeedbackCycle = require("../models/Feedbackcycle");

// ─────────────────────────────────────────
// POST /api/feedback-cycles
// Create a new feedback cycle (Launch)
// ─────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const {
      cycleName,
      period,
      startDate,
      endDate,
      reviewerConfig,
      weightage,
      peerCount,
      subCount,
      selectedEmployees,
      createdBy,
    } = req.body;

    // Validate total weight = 100
    const totalWeight =
      (reviewerConfig.manager      ? weightage.manager      : 0) +
      (reviewerConfig.peers        ? weightage.peers        : 0) +
      (reviewerConfig.subordinates ? weightage.subordinates : 0) +
      (reviewerConfig.self         ? weightage.self         : 0);

    if (totalWeight !== 100) {
      return res.status(400).json({
        success: false,
        message: `Total weightage must be 100%. Currently: ${totalWeight}%`,
      });
    }

    const cycle = new FeedbackCycle({
      cycleName,
      period,
      startDate,
      endDate,
      reviewerConfig,
      weightage,
      peerCount,
      subCount,
      selectedEmployees,
      createdBy,
      status: "active",
    });

    await cycle.save();

    res.status(201).json({
      success: true,
      message: "Feedback cycle launched successfully!",
      data: cycle,
    });
  } catch (err) {
    console.error("Create cycle error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/feedback-cycles
// Get all feedback cycles
// ─────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const cycles = await FeedbackCycle.find()
      .populate("selectedEmployees", "name role department")
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      data: cycles,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/feedback-cycles/:id
// Get single cycle by ID
// ─────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const cycle = await FeedbackCycle.findById(req.params.id)
      .populate("selectedEmployees", "name role department");

    if (!cycle) {
      return res.status(404).json({ success: false, message: "Cycle not found" });
    }

    res.status(200).json({ success: true, data: cycle });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ─────────────────────────────────────────
// PATCH /api/feedback-cycles/:id/status
// Update cycle status (active / completed)
// ─────────────────────────────────────────
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    if (!["draft", "active", "completed"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status value" });
    }

    const cycle = await FeedbackCycle.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!cycle) {
      return res.status(404).json({ success: false, message: "Cycle not found" });
    }

    res.status(200).json({ success: true, message: "Status updated", data: cycle });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ─────────────────────────────────────────
// DELETE /api/feedback-cycles/:id
// Delete a cycle
// ─────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const cycle = await FeedbackCycle.findByIdAndDelete(req.params.id);

    if (!cycle) {
      return res.status(404).json({ success: false, message: "Cycle not found" });
    }

    res.status(200).json({ success: true, message: "Cycle deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

module.exports = router;