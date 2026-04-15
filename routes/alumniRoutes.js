const express = require("express");
const router  = express.Router();
const {
  createAlumni, getAllAlumni, getAlumniStats,
  getAlumniById, updateAlumni,
  addEngagement, addReferral, updateReferralStatus,
  addMentorshipSession,
} = require("../controllers/alumniController");

// ── Core CRUD ─────────────────────────────────────────────────
router.post  ("/alumni",              createAlumni);         // Create alumni (on offboarding)
router.get   ("/alumni",              getAllAlumni);          // Get all alumni (with filters)
router.get   ("/alumni/stats",        getAlumniStats);        // Dashboard stats
router.get   ("/alumni/:id",          getAlumniById);         // Single alumni detail
router.put   ("/alumni/:id",          updateAlumni);          // Update profile

// ── Engagement ────────────────────────────────────────────────
router.post  ("/alumni/:id/engagement",          addEngagement);        // Log engagement activity
router.post  ("/alumni/:id/referral",            addReferral);          // Add referral
router.put   ("/alumni/:id/referral/:refId",     updateReferralStatus); // Update referral status
router.post  ("/alumni/:id/mentorship-session",  addMentorshipSession); // Log mentorship session

module.exports = router;