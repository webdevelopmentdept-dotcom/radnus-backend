const express = require("express");
const router = express.Router();
const {
  createAlumni, getAllAlumni, getAlumniStats,
  getAlumniById, updateAlumni,
  addEngagement, addReferral, updateReferralStatus,
  addMentorshipSession,
} = require("../controllers/alumniController");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");

// ── Core CRUD ─────────────────────────────────────────────────
router.post("/alumni", auth, hrOnly, createAlumni);         // Create alumni (on offboarding)
router.get("/alumni", getAllAlumni);          // Get all alumni (with filters)
router.get("/alumni/stats", auth, hrOnly, getAlumniStats);        // Dashboard stats
router.get("/alumni/:id", getAlumniById);         // Single alumni detail
router.put("/alumni/:id", updateAlumni);          // Update profile

// ── Engagement ────────────────────────────────────────────────
router.post("/alumni/:id/engagement", auth, hrOnly, addEngagement);        // Log engagement activity
router.post("/alumni/:id/referral", addReferral);          // Add referral
router.put("/alumni/:id/referral/:refId", auth, hrOnly, updateReferralStatus); // Update referral status
router.post("/alumni/:id/mentorship-session", auth, hrOnly, addMentorshipSession); // Log mentorship session

module.exports = router;