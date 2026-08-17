const express = require("express");
const router  = express.Router();
const {
  getAllPrograms, createProgram, updateProgram, deleteProgram, deleteAllPrograms, seedDefaultPrograms,
  backfillEquipmentPrograms, consolidateEquipmentPrograms, getProgramProducts,
  getQuizQuestions, createQuizQuestion, updateQuizQuestion, deleteQuizQuestion,
  markProductStudied, getQuiz, submitQuiz,
  assignTraining, assignBulk, getAllRecords, getStats, updateRecord, getComplianceLog,
  getMyTrainings, markStarted, updateCompetencyLevel,
} = require("../controllers/trainingrcaController");

// ── Programs (Master Data) ────────────────────────────────────
router.get   ("/training/programs",        getAllPrograms);
router.post  ("/training/programs",        createProgram);
router.put   ("/training/programs/:id",    updateProgram);
router.delete("/training/programs/:id",    deleteProgram);
router.delete("/training/programs",        deleteAllPrograms);   // ✅ NEW — must be ABOVE "/:id" wouldn't matter for DELETE (different path), but kept together here
router.post  ("/training/seed",            seedDefaultPrograms);
router.post  ("/training/backfill-equipment", backfillEquipmentPrograms); // ✅ NEW
router.post  ("/training/consolidate-equipment", consolidateEquipmentPrograms); // ✅ NEW — one-time merge of per-product equipment programs into one shared program
router.get   ("/training/programs/:id/products", getProgramProducts); // ✅ NEW — products covered by a program, for the employee "View Details" card

// ── HR Assignment ─────────────────────────────────────────────
router.post  ("/training/assign",          assignTraining);
router.post  ("/training/assign-bulk",     assignBulk);
router.get   ("/training/records",         getAllRecords);
router.get   ("/training/stats",           getStats);
router.put   ("/training/records/:id",     updateRecord);
router.put   ("/training/records/:id/competency", updateCompetencyLevel);
router.get   ("/training/compliance-log",  getComplianceLog);

// ── Quiz Question Bank (HR) ───────────────────────────────────
router.get   ("/training/quiz-questions",        getQuizQuestions);
router.post  ("/training/quiz-questions",        createQuizQuestion);
router.put   ("/training/quiz-questions/:id",    updateQuizQuestion);
router.delete("/training/quiz-questions/:id",    deleteQuizQuestion);

// ── Employee ──────────────────────────────────────────────────
router.get   ("/training/my/:employeeId",              getMyTrainings);
router.put   ("/training/my/:recordId/start",          markStarted);
router.put   ("/training/my/:recordId/study-product",  markProductStudied); // ✅ NEW — mark one product as studied
router.get   ("/training/my/:recordId/quiz",            getQuiz);           // ✅ NEW — fetch combined quiz
router.post  ("/training/my/:recordId/quiz/submit",     submitQuiz);        // ✅ NEW — auto-score submission

module.exports = router;