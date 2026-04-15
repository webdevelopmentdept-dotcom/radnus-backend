const express = require("express");
const router  = express.Router();
const {
  getAllPrograms, createProgram, updateProgram, deleteProgram, seedDefaultPrograms,
  assignTraining, assignBulk, getAllRecords, getStats, updateRecord, getComplianceLog,
  getMyTrainings, markStarted,
} = require("../controllers/trainingrcaController");

// ── Programs (Master Data) ────────────────────────────────────
router.get   ("/training/programs",        getAllPrograms);
router.post  ("/training/programs",        createProgram);
router.put   ("/training/programs/:id",    updateProgram);
router.delete("/training/programs/:id",    deleteProgram);
router.post  ("/training/seed",            seedDefaultPrograms);

// ── HR Assignment ─────────────────────────────────────────────
router.post  ("/training/assign",          assignTraining);
router.post  ("/training/assign-bulk",     assignBulk);
router.get   ("/training/records",         getAllRecords);
router.get   ("/training/stats",           getStats);
router.put   ("/training/records/:id",     updateRecord);
router.get   ("/training/compliance-log",  getComplianceLog);

// ── Employee ──────────────────────────────────────────────────
router.get   ("/training/my/:employeeId",              getMyTrainings);
router.put   ("/training/my/:recordId/start",          markStarted);

module.exports = router;