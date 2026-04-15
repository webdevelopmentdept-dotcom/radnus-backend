// routes/FeedbackNomination.js

const express = require("express");
const router = express.Router();
const FeedbackNomination = require("../models/Feedbacknomination");
const FeedbackCycle = require("../models/Feedbackcycle");
const Notification = require("../models/Notification");
const FeedbackTask = require("../models/FeedbackTask");
const mongoose = require("mongoose");
// ─────────────────────────────────────────
// POST /api/feedback-nominations
// Submit nominations for a cycle
// ─────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const { cycleId, nominations } = req.body;

    if (!cycleId || !nominations || nominations.length === 0) {
      return res.status(400).json({ success: false, message: "cycleId and nominations required" });
    }

    // Delete existing nominations for this cycle (re-submit support)
    await FeedbackNomination.deleteMany({ cycleId });

    // ✅ Save nominations (managerId can be null — HR will assign later)
    const docs = nominations.map((n) => ({
      cycleId,
      employeeId:     n.employeeId,
      managerId:      n.managerId || null,
      peerIds:        n.peerIds || [],
      subordinateIds: n.subordinateIds || [],
      status: "pending",
    }));

    await FeedbackNomination.insertMany(docs);

    // ─────────────────────────────────────────
    // 🔥 CREATE FEEDBACK TASKS
    // ─────────────────────────────────────────
    const tasks = [];

    for (const n of nominations) {

    if (n.managerId) {
  tasks.push({
    cycleId: new mongoose.Types.ObjectId(cycleId),
    reviewerId: new mongoose.Types.ObjectId(n.managerId),
    revieweeId: new mongoose.Types.ObjectId(n.employeeId),
    reviewerType: "manager",
    status: "PENDING",
  });
}

     for (const peerId of n.peerIds || []) {
  tasks.push({
    cycleId: new mongoose.Types.ObjectId(cycleId),
    reviewerId: new mongoose.Types.ObjectId(peerId),
    revieweeId: new mongoose.Types.ObjectId(n.employeeId),
    reviewerType: "peer",
    status: "PENDING",
  });
}
await FeedbackTask.deleteMany({});
   for (const subId of n.subordinateIds || []) {
  tasks.push({
    cycleId: new mongoose.Types.ObjectId(cycleId),
    reviewerId: new mongoose.Types.ObjectId(subId),
    revieweeId: new mongoose.Types.ObjectId(n.employeeId),
    reviewerType: "subordinate",
    status: "PENDING",
  });
}
await FeedbackTask.deleteMany({});
     tasks.push({
  cycleId: new mongoose.Types.ObjectId(cycleId),
  reviewerId: new mongoose.Types.ObjectId(n.employeeId),
  revieweeId: new mongoose.Types.ObjectId(n.employeeId),
  reviewerType: "self",
  status: "PENDING",
});
    }

    // Delete old tasks and insert new ones
    await FeedbackTask.deleteMany({ cycleId });
    await FeedbackTask.insertMany(tasks);

    // ─────────────────────────────────────────
    // 📢 SEND NOTIFICATIONS
    // ─────────────────────────────────────────
    const cycle     = await FeedbackCycle.findById(cycleId);
    const cycleName = cycle?.cycleName || "360° Feedback";

    const notifDocs = [];

    for (const n of nominations) {

      // ✅ Notify Peers only (manager will be notified when HR assigns)
      for (const peerId of n.peerIds || []) {
        notifDocs.push({
          recipient_id:   peerId,
          recipient_role: "employee",
          title:          "360° Peer Review Request",
          message:        `You have been selected as a Peer reviewer in the "${cycleName}" feedback cycle.`,
          type:           "general",
          isRead:         false,
        });
      }

      // ✅ Notify Subordinates
      for (const subId of n.subordinateIds || []) {
        notifDocs.push({
          recipient_id:   subId,
          recipient_role: "employee",
          title:          "360° Subordinate Review Request",
          message:        `You have been selected as a Subordinate reviewer in the "${cycleName}" feedback cycle.`,
          type:           "general",
          isRead:         false,
        });
      }
    }

    if (notifDocs.length > 0) {
      await Notification.insertMany(notifDocs);
    }

    res.status(201).json({
      success: true,
      message: `Nominations saved! ${tasks.length} tasks and ${notifDocs.length} notifications created.`,
    });

  } catch (err) {
    console.error("Nomination error:", err);
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ─────────────────────────────────────────
// GET /api/feedback-nominations/:cycleId
// Get nominations for a specific cycle
// ─────────────────────────────────────────
router.get("/:cycleId", async (req, res) => {
  try {
    const nominations = await FeedbackNomination.find({ cycleId: req.params.cycleId })
      .populate("employeeId", "name department")
      .populate("managerId",  "name department")
      .populate("peerIds",    "name department");

    res.status(200).json({ success: true, data: nominations });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error", error: err.message });
  }
});

// ─────────────────────────────────────────
// DELETE /api/feedback-nominations/:cycleId
// Delete all nominations + tasks for a cycle
// ─────────────────────────────────────────
router.delete("/:cycleId", async (req, res) => {
  try {
    await FeedbackNomination.deleteMany({ cycleId: req.params.cycleId });
    await FeedbackTask.deleteMany({ cycleId: req.params.cycleId });
    res.json({ success: true, message: "Nominations deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ✅ GET /api/feedback-nominations — Dashboard total count
router.get("/", async (req, res) => {
  try {
    const nominations = await FeedbackNomination.find();
    res.json({ success: true, total: nominations.length, data: nominations });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;