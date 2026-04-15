const express = require("express");
const router = express.Router();
const ClubMember = require("../models/ClubMember");
const ClubEvent = require("../models/ClubEvent");
const ClubPoints = require("../models/ClubPoints");

const VALID_CLUBS = ["tech", "fitness", "creativity"];

// ── Validate club ──
router.param("club", (req, res, next, val) => {
  if (!VALID_CLUBS.includes(val)) {
    return res.status(400).json({ success: false, message: "Invalid club name" });
  }
  next();
});


// ═════════════════════ MEMBERS ═════════════════════

// GET all members
router.get("/:club/members", async (req, res) => {
  try {
    const members = await ClubMember.find({ club: req.params.club })
      .populate("employee_id", "name department email")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: members });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET my membership
router.get("/:club/my-membership", async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id) return res.json({ success: true, data: null });

    const mem = await ClubMember.findOne({
      club: req.params.club,
      employee_id,
    });

    res.json({ success: true, data: mem });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// JOIN club
router.post("/:club/members", async (req, res) => {
  try {
    const { employee_id } = req.body;

    if (!employee_id) {
      return res.status(400).json({ success: false, message: "employee_id required" });
    }

    const existing = await ClubMember.findOne({
      club: req.params.club,
      employee_id,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message:
          existing.status === "approved"
            ? "Already a member"
            : "Request already pending",
      });
    }

    const mem = await ClubMember.create({
      club: req.params.club,
      employee_id,
      status: "pending",
    });

    res.status(201).json({
      success: true,
      data: mem,
      message: "Join request submitted",
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// APPROVE member
router.patch("/:club/members/:id/approve", async (req, res) => {
  try {
    const mem = await ClubMember.findByIdAndUpdate(
      req.params.id,
      { status: "approved", joined_at: new Date() },
      { new: true }
    ).populate("employee_id", "name department");

    if (!mem) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.json({ success: true, data: mem });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// REMOVE member
router.delete("/:club/members/:id", async (req, res) => {
  try {
    await ClubMember.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Member removed" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ═════════════════════ EVENTS ═════════════════════

// GET events
router.get("/:club/events", async (req, res) => {
  try {
    const events = await ClubEvent.find({ club: req.params.club }).sort({ date: 1 });
    res.json({ success: true, data: events });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// CREATE event
router.post("/:club/events", async (req, res) => {
  try {
    const { title, activity_type } = req.body;

    if (!title || !activity_type) {
      return res.status(400).json({
        success: false,
        message: "title and activity_type required",
      });
    }

    const ev = await ClubEvent.create({
      ...req.body,
      club: req.params.club,
    });

    res.status(201).json({ success: true, data: ev });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE event
router.put("/:club/events/:id", async (req, res) => {
  try {
    const ev = await ClubEvent.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!ev) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.json({ success: true, data: ev });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// UPDATE event status
router.patch("/:club/events/:id/status", async (req, res) => {
  try {
    const { status } = req.body;

    const ev = await ClubEvent.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    res.json({ success: true, data: ev });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE event
router.delete("/:club/events/:id", async (req, res) => {
  try {
    await ClubEvent.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ═════════════════════ POINTS ═════════════════════

// GET points
router.get("/:club/points", async (req, res) => {
  try {
    const pts = await ClubPoints.find({ club: req.params.club })
      .populate("employee_id", "name department")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: pts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// AWARD points
router.post("/:club/points", async (req, res) => {
  try {
    const { employee_id, points } = req.body;

    if (!employee_id || !points) {
      return res.status(400).json({
        success: false,
        message: "employee_id and points required",
      });
    }

    const mem = await ClubMember.findOne({
      club: req.params.club,
      employee_id,
      status: "approved",
    });

    if (!mem) {
      return res.status(400).json({
        success: false,
        message: "Not an approved member",
      });
    }

    const pt = await ClubPoints.create({
      ...req.body,
      club: req.params.club,
    });

    await ClubMember.findByIdAndUpdate(mem._id, {
      $inc: { total_points: points },
    });

    res.status(201).json({ success: true, data: pt });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE points
router.delete("/:club/points/:id", async (req, res) => {
  try {
    await ClubPoints.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ═════════════════════ STATS (FIXED) ═════════════════════

// 🔥 THIS FIXES YOUR 404
router.get("/:club/stats", async (req, res) => {
  try {
    const club = req.params.club;

    const [totalMembers, pendingMembers, upcomingEvents, totalPoints] = await Promise.all([
      ClubMember.countDocuments({ club, status: "approved" }),
      ClubMember.countDocuments({ club, status: "pending" }),
      ClubEvent.countDocuments({
        club,
        status: { $in: ["upcoming", "ongoing"] },
      }),
      ClubPoints.aggregate([
        { $match: { club } },
        { $group: { _id: null, total: { $sum: "$points" } } },
      ]),
    ]);

    res.json({
      success: true,
      data: {
        totalMembers,
        pendingMembers,
        upcomingEvents,
        totalPointsAwarded: totalPoints[0]?.total || 0,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;