// routes/policyQuizRoutes.js
const express = require("express");
const router = express.Router();
const {
  upsertQuiz,
  getQuizByPolicy,
  deleteQuiz,
  getQuizStats,
  startQuiz,
  submitQuiz,
  checkAttempt,
} = require("../controllers/policyQuizController");

// ── HR Routes ──────────────────────────────
router.post("/", upsertQuiz);                              // Create / update quiz
router.get("/policy/:policy_id", getQuizByPolicy);         // Get quiz questions (HR view)
router.delete("/policy/:policy_id", deleteQuiz);           // Remove quiz
router.get("/stats/:policy_id", getQuizStats);             // Attempt stats

// ── Employee Routes ────────────────────────
router.get("/start/:policy_id", startQuiz);                // Get 5 shuffled questions
router.post("/submit", submitQuiz);                        // Submit answers
router.get("/check/:policy_id/:employee_id", checkAttempt); // Already passed?

module.exports = router;

// ─── Register in app.js / server.js ───────────────────────────────────────────
// const policyQuizRoutes = require("./routes/policyQuizRoutes");
// app.use("/api/policy-quiz", policyQuizRoutes);