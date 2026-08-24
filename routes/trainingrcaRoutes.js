const express = require("express");
const router  = express.Router();
const {
  getAllPrograms, createProgram, updateProgram, deleteProgram, deleteAllPrograms, seedDefaultPrograms,
  backfillEquipmentPrograms, consolidateEquipmentPrograms, getProgramProducts,
  getQuizQuestions, createQuizQuestion, updateQuizQuestion, deleteQuizQuestion,
  markProductStudied, markVideoWatched, markPdfRead, markProgramComplete, getQuiz, submitQuiz,
  assignTraining, assignBulk, getAllRecords, getStats, updateRecord, deleteRecord, markAllComplete, getComplianceLog,
  getMyTrainings, markStarted, updateCompetencyLevel,
} = require("../controllers/trainingrcaController");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    // Same storage config handles BOTH the "video" and "pdf" form fields
    // (multer.fields below), branching on fieldname so each goes to its
    // own Cloudinary folder with the right resource_type.
    if (file.fieldname === "pdf") {
      return {
        folder: "radnus-connect/training-pdfs",
        resource_type: "raw", // PDFs must be "raw", not "image"/"video", on Cloudinary
        public_id: `training_pdf_${Date.now()}`,
        format: "pdf",
      };
    }
    return {
      folder: "radnus-connect/training-videos",
      resource_type: "video",
      public_id: `training_${Date.now()}`,
    };
  },
});
const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 100 * 1024 * 1024 } });
const uploadTrainingFiles = uploadVideo.fields([{ name: "video", maxCount: 1 }, { name: "pdf", maxCount: 1 }]);

// ── Programs (Master Data) ────────────────────────────────────
router.get   ("/training/programs",        getAllPrograms);
router.post("/training/programs", uploadTrainingFiles, createProgram);
router.put ("/training/programs/:id", uploadTrainingFiles, updateProgram);
router.delete("/training/programs/:id",    deleteProgram);
router.delete("/training/programs",        deleteAllPrograms);
router.post  ("/training/seed",            seedDefaultPrograms);
router.post  ("/training/backfill-equipment", backfillEquipmentPrograms);
router.post  ("/training/consolidate-equipment", consolidateEquipmentPrograms);
router.get   ("/training/programs/:id/products", getProgramProducts);
router.put   ("/training/programs/:id/mark-all-complete", markAllComplete);

// ── HR Assignment ─────────────────────────────────────────────
router.post  ("/training/assign",          assignTraining);
router.post  ("/training/assign-bulk",     assignBulk);
router.get   ("/training/records",         getAllRecords);
router.get   ("/training/stats",           getStats);
router.put   ("/training/records/:id",     updateRecord);
router.delete("/training/records/:id",     deleteRecord);
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
router.put   ("/training/my/:recordId/study-product",  markProductStudied);
router.put   ("/training/my/:recordId/video-watched",  markVideoWatched);
router.put   ("/training/my/:recordId/pdf-read",        markPdfRead);
router.put   ("/training/my/:recordId/complete",       markProgramComplete);
router.get   ("/training/my/:recordId/quiz",            getQuiz);
router.post  ("/training/my/:recordId/quiz/submit",     submitQuiz);

module.exports = router;