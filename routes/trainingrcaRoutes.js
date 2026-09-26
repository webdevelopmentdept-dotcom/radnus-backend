const express = require("express");
const router  = express.Router();
const {
  getAllPrograms, createProgram, updateProgram, deleteProgram, deleteAllPrograms, seedDefaultPrograms,
  backfillEquipmentPrograms, consolidateEquipmentPrograms, getProgramProducts,
  getQuizQuestions, createQuizQuestion, updateQuizQuestion, deleteQuizQuestion,
  markProductStudied, markVideoWatched, markPdfRead, markProgramComplete, getQuiz, submitQuiz,
  assignTraining, assignBulk, getAllRecords, getStats, updateRecord, deleteRecord, markAllComplete, getComplianceLog,
  getMyTrainings, markStarted, updateCompetencyLevel,
  lockRecord, unlockRecord, // ✅ NEW
  markChapterWatched, markChapterHeartbeat, requestCertificate, uploadCertificate,
  getChapterQuiz, submitChapterQuiz,
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
        folder: "radnus-hrms/training-pdfs",
        resource_type: "raw", // PDFs must be "raw", not "image"/"video", on Cloudinary
        public_id: `training_pdf_${Date.now()}`,
        format: "pdf",
      };
    }
    return {
      folder: "radnus-hrms/training-videos",
      resource_type: "video",
      public_id: `training_${Date.now()}`,
    };
  },
});
const uploadVideo = multer({ storage: videoStorage, limits: { fileSize: 100 * 1024 * 1024 } });
// ✅ NEW — "chapterVideos" carries every newly-uploaded chapter video in
// one request (up to 100 chapters), alongside the existing single
// "video"/"pdf" fields — none of the old single-video upload behaviour
// changes.
const uploadTrainingFiles = uploadVideo.fields([
  { name: "video", maxCount: 1 },
  { name: "pdf", maxCount: 1 },
  { name: "chapterVideos", maxCount: 100 },
]);

// ✅ NEW — certificate upload storage (HR uploads a per-employee
// certificate file, image or PDF).
const certificateStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "radnus-connect/training-certificates",
    resource_type: file.mimetype === "application/pdf" ? "raw" : "image",
    public_id: `certificate_${Date.now()}`,
    // ✅ FIX — PDF certificates were being stored with no file extension,
    // so the saved/opened file wasn't recognized as a PDF by the browser/OS.
    // Same pattern already used for training-material PDFs above.
    format: file.mimetype === "application/pdf" ? "pdf" : undefined,
  }),
});
const uploadCertificateFile = multer({ storage: certificateStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ── Programs (Master Data) ────────────────────────────────────
router.get   ("/training/programs",        getAllPrograms);
// ✅ NEW — signed params so the HR browser can upload big chapter videos
// (100 MB+) straight to Cloudinary in chunks, bypassing this server.
// API secret never leaves the server; only the signature is returned.
router.get("/training/upload-signature", (req, res) => {
  try {
    const isPdf = req.query.kind === "pdf"; // ✅ NEW — same endpoint, PDF chapters go to /raw/upload instead of /video/upload
    const timestamp = Math.round(Date.now() / 1000);
    const folder = isPdf ? "radnus-hrms/training-pdfs" : "radnus-hrms/training-videos";
    const rand = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const public_id = isPdf ? `training_${rand}.pdf` : `training_${rand}`;
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, folder, public_id },
      process.env.CLOUDINARY_API_SECRET
    );
    res.json({
      success: true,
      data: {
        cloudName: process.env.CLOUDINARY_CLOUD_NAME,
        apiKey: process.env.CLOUDINARY_API_KEY,
        resourceType: isPdf ? "raw" : "video",
        timestamp, folder, public_id, signature,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});
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
router.put   ("/training/records/:id/lock",   lockRecord);   // ✅ NEW
router.put   ("/training/records/:id/unlock", unlockRecord); // ✅ NEW
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

// ✅ NEW — multi-chapter course progress + certificate request/issue
router.put   ("/training/my/:recordId/chapter/:chapterNo/watched", markChapterWatched);
router.put   ("/training/my/:recordId/chapter/:chapterNo/heartbeat", markChapterHeartbeat); // ✅ server-side watch tracking
// ✅ NEW — optional per-chapter quiz (unlimited retries, gates only the next chapter)
router.get   ("/training/my/:recordId/chapter/:chapterNo/quiz",        getChapterQuiz);
router.post  ("/training/my/:recordId/chapter/:chapterNo/quiz/submit", submitChapterQuiz);
router.put   ("/training/my/:recordId/certificate/request",        requestCertificate);
router.put   ("/training/records/:id/certificate", uploadCertificateFile.fields([{ name: "certificate", maxCount: 1 }]), uploadCertificate);

module.exports = router;