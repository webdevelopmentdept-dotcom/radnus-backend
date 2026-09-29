const mongoose = require("mongoose");

// ─── Training Program Master ──────────────────────────────────
const trainingProgramSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  // ✅ NEW — course-level intro text shown above the chapter list
  // (e.g. "A complete sales team management program covering..."). Only
  // used by multi-chapter courses; plain single-video programs can
  // leave this blank same as before.
  description: { type: String, default: "" },
  level:       { type: String, enum: ["L1","L2","L3","L4","L5","L6","all"], default: "all" },
  department:  { type: String, default: "all" }, // "all" or specific dept
  type:        { type: String, enum: ["induction","job_role","cross_functional","culture","refresher","department","equipment"], default: "job_role" },
  modules:     [{ type: String }],

  // ✅ NEW — multi-chapter course support (e.g. "66 video sessions").
  // Empty array = old behaviour unchanged (single program-level video
  // below is used). Non-empty array = employee side renders the
  // chapter-by-chapter, sequentially-unlocked course UI instead.
  chapters: [{
    chapterNo:     { type: Number, required: true },   // 1, 2, 3...
    title:         { type: String, required: true },
    description:   { type: String, default: "" },
    contentType:   { type: String, enum: ["video","pdf"], default: "video" }, // ✅ NEW — a chapter can be a video OR a PDF
    videoSource:   { type: String, enum: ["upload","youtube"], default: "upload" },
    videoUrl:      { type: String, default: "" },
    videoPublicId: { type: String, default: "" },
    duration:      { type: String, default: "" },      // "5 min", display only — video chapters only
    pdfUrl:        { type: String, default: "" },      // ✅ NEW — PDF chapters only
    pdfPublicId:   { type: String, default: "" },

    // ✅ NEW — optional per-chapter "understanding check" quiz.
    // Empty array (default) = no quiz for this chapter — nothing
    // changes, employee still goes straight from video/PDF to
    // "Complete chapter"/"Mark as Read". Non-empty = employee must
    // pass this quiz (>= PASS_THRESHOLD, UNLIMITED retries — this only
    // gates the next chapter unlocking, it's a learning check, not a
    // certification gate) before the chapter is marked watched.
    // Completely separate from quizQuestionSchema below, which is the
    // program-level Final Test (single attempt, HR-review/certification).
    quizQuestions: [{
      questionText:       { type: String, required: true },
      options:             { type: [String], validate: v => v.length === 4 }, // exactly 4 options
      correctOptionIndex: { type: Number, required: true, min: 0, max: 3 },
    }],
  }],

  // ✅ NEW — HR-controlled access window for chapter-based courses.
  // Employee can only open/watch chapters between these two dates.
  // Both null = always open (old behaviour, and default for programs
  // HR hasn't set a window for). Only HR can set/change these — there
  // is no employee-facing control for this anywhere.
  accessStartDate: { type: Date, default: null },
  accessEndDate:   { type: Date, default: null },

  // Links this program to a specific product/equipment card in the
  // Knowledge/Product Portal (models/Product.js). null = a general
  // (non-equipment) program, OR the single shared equipment program
  // that covers every product (see isShared below).
  productId:   { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  // True for the ONE combined "Equipment Training" program that every
  // product links to (Product.trainingProgramId). Only ever one such
  // document should exist — used to find it instead of creating a new
  // per-product program each time.
  isShared:    { type: Boolean, default: false },
  duration:    { type: String, default: "" },       // "7 Days", "1 Month", etc.
    // Offline (in-person/classroom) training support
  deliveryMode: { type: String, enum: ["online","offline"], default: "online" },
  sessionDate:  { type: Date, default: null },
  sessionTime:  { type: String, default: "" },  
  venue:        { type: String, default: "" },
  videoSource: { type: String, enum: ["upload","youtube",""], default: "" },
videoUrl:    { type: String, default: "" },   // Cloudinary URL OR YouTube link
videoPublicId: { type: String, default: "" },
  // ✅ NEW — optional PDF training material (Cloudinary-hosted), separate
  // from the video. A program can have a video, a PDF, both, or neither.
  pdfUrl:      { type: String, default: "" },
  pdfPublicId: { type: String, default: "" },
  pdfName:     { type: String, default: "" }, // original filename, shown to employee
  certification: { type: String, default: "" },     // "RCA Foundation Certificate"
  conductedBy: { type: String, default: "" },       // "HR & Culture"
  frequency:   { type: String, enum: ["once","monthly","quarterly","half_yearly","annual","on_joining","within_30_days"], default: "once" },
  responsible: { type: String, default: "" },       // "HR & L&D"
  isMandatory: { type: Boolean, default: true },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true });

// ─── Employee Training Record ─────────────────────────────────
const employeeTrainingSchema = new mongoose.Schema({
  employeeId:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  programId:    { type: mongoose.Schema.Types.ObjectId, ref: "TrainingProgram", required: true },
status:       { type: String, enum: ["pending","in_progress","completed","overdue","waived","failed_retake","needs_hr_review","pending_review","retrain","absent"], default: "pending" },
  assignedDate: { type: Date, default: Date.now },
  dueDate:      { type: Date },
  startedDate:  { type: Date },
  completedDate:{ type: Date },

  assessmentScore: { type: Number, default: null }, // post-training score %
  certificationIssued: { type: Boolean, default: false },
  certificationDate:   { type: Date },

    submittedForReview: { type: Boolean, default: false },
  submittedDate:       { type: Date },

  // Per-product "studied" checklist — only meaningful for "equipment"
  // type programs (which cover several products). Employee marks each
  // product as studied before the combined quiz unlocks.
  productProgress: [{
    productId: { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    studied:   { type: Boolean, default: false },
    studiedAt: { type: Date },
  }],

  // ✅ NEW — tracks whether the employee actually finished watching the
  // program-level training video (non-equipment programs, e.g. "Excel
  // training"). Set to true only when the <video> onEnded event fires,
  // so it can't be faked by just opening the modal.
  videoWatched:   { type: Boolean, default: false },
  videoWatchedAt: { type: Date },

  // ✅ NEW — same idea for a PDF document attached to the program. PDFs
  // have no reliable "finished" event like a video does, so this is set
  // when the employee explicitly confirms via the "Mark as Read" button
  // (only enabled after they've opened the PDF at least once).
  pdfRead:   { type: Boolean, default: false },
  pdfReadAt: { type: Date },

  // ✅ NEW — per-chapter watch progress for multi-chapter courses.
  // Chapters unlock strictly in order: chapter N can only be marked
  // watched once chapter N-1 is already watched (enforced server-side
  // in markChapterWatched, not just hidden in the UI).
  chapterProgress: [{
    chapterNo:    { type: Number, required: true },
    watched:      { type: Boolean, default: false },
    watchedAt:    { type: Date },
    watchPercent: { type: Number, default: 0 }, // % of the video VERIFIED as actually played (server-computed)
    // ✅ Server-side watch tracking (heartbeats) — see markChapterHeartbeat
    duration:      { type: Number, default: 0 },   // video length in seconds (from first heartbeat)
    watchedRanges: { type: [[Number]], default: [] }, // merged [start,end] second ranges actually played
    lastPosition:  { type: Number, default: 0 },   // where to resume
    lastBeatAt:    { type: Date },                 // server time of the last heartbeat
    startedAt:     { type: Date },                 // server time of the first heartbeat
    playedSeconds: { type: Number, default: 0 },   // total real playback credited (incl. re-watching)

    // ✅ NEW — for a chapter that HAS a quiz: the video/PDF itself is
    // confirmed done here (video's verified % / PDF "Mark as Read"
    // click), but `watched` (which unlocks the next chapter) is only
    // set once the quiz below is actually passed. For a chapter with NO
    // quiz, this is never used — watched is still set directly, exactly
    // like before.
    contentDone:   { type: Boolean, default: false },
    contentDoneAt: { type: Date },

    // ✅ NEW — chapter quiz attempt history (only used when the chapter
    // has quizQuestions above). Unlimited retries, so this is kept as an
    // array purely for audit/HR-reporting — unlike quizAttempts below
    // (the Final Test), there is no "1 attempt" restriction here.
    quizAttempts: [{
      score:       { type: Number },    // percentage
      passed:      { type: Boolean },
      attemptedAt: { type: Date, default: Date.now },
    }],
    lastScore: { type: Number, default: null }, // most recent chapter-quiz % — HR reporting
  }],

  // ✅ NEW — certificate request/issue flow. Employee finishes every
  // chapter + passes the quiz → requests a certificate → HR uploads
  // the actual certificate file for that employee → employee can
  // download it. Nothing here is auto-generated; HR always issues it.
  certificateRequestStatus: { type: String, enum: ["none","requested","issued"], default: "none" },
  certificateRequestedAt:   { type: Date },
  certificateUrl:           { type: String, default: "" },   // Cloudinary URL, set only when HR uploads
  certificatePublicId:      { type: String, default: "" },
  certificateFileName:      { type: String, default: "" },
  certificateIssuedAt:      { type: Date },

  // Quiz attempt history. Policy: single attempt only — one submission
  // per record. Kept as an array for audit history even though only
  // one entry is ever pushed.
  quizAttempts: [{
    score:     { type: Number },       // percentage
    passed:    { type: Boolean },
    answers:   [{
      questionId: { type: mongoose.Schema.Types.ObjectId, ref: "QuizQuestion" },
      selectedOptionIndex: { type: Number },
      correct: { type: Boolean },
    }],
    attemptedAt: { type: Date, default: Date.now },
  }],

  // 4-level equipment competency ladder from the Knowledge/Product Portal plan.
  // Only meaningful when programId.type === "equipment"; null otherwise.
  competencyLevel: {
    type: String,
    enum: ["KNOW","OPERATE","SERVICE","TRAIN", null],
    default: null,
  },

  // ✅ NEW — Lock/Unlock. HR can lock any time (manual), or it locks
  // itself once dueDate passes (auto_due_date). Once HR unlocks a
  // record, auto-lock will NOT re-trigger for it again — HR has to
  // lock it again manually, or push the dueDate forward.
  isLocked:    { type: Boolean, default: false },
  lockReason:  { type: String, enum: ["manual", "auto_due_date", null], default: null },
  lockedAt:    { type: Date },
  lockedBy:    { type: String },
  unlockedAt:  { type: Date },
  unlockedBy:  { type: String },

  notes:   { type: String, default: "" },
  addedBy: { type: String, default: "HR" },

  // Progress logs
  progressLog: [{
    note:    { type: String },
    date:    { type: Date, default: Date.now },
    addedBy: { type: String, default: "HR" },
  }],
}, { timestamps: true });

// ─── Training Compliance Log (HRF-TR-01) ─────────────────────
const complianceLogSchema = new mongoose.Schema({
  employeeId:  { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  programId:   { type: mongoose.Schema.Types.ObjectId, ref: "TrainingProgram" },
  programTitle:{ type: String },
action:      { type: String, enum: ["assigned","started","completed","overdue","score_updated","cert_issued","waived","retrain","absent","bulk_completed","pending","failed_retake","needs_hr_review","pending_review"] },
  note:        { type: String, default: "" },
  addedBy:     { type: String, default: "HR" },
  date:        { type: Date, default: Date.now },
}, { timestamps: true });

// ─── Quiz Question Bank (HR-authored, per product OR per program) ────
const quizQuestionSchema = new mongoose.Schema({
  // Exactly ONE of these two is set per question — equipment-training
  // questions are linked to a Product, non-equipment programs
  // (e.g. "Excel training") link straight to the TrainingProgram.
  productId:     { type: mongoose.Schema.Types.ObjectId, ref: "Product", default: null },
  programId:     { type: mongoose.Schema.Types.ObjectId, ref: "TrainingProgram", default: null },
  questionText:  { type: String, required: true },
  options:       { type: [String], validate: v => v.length === 4 }, // exactly 4 options
  correctOptionIndex: { type: Number, required: true, min: 0, max: 3 },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });

quizQuestionSchema.pre("validate", function (next) {
  if (!this.productId && !this.programId) {
    return next(new Error("Either productId or programId is required"));
  }
  if (this.productId && this.programId) {
    return next(new Error("A question can only be linked to a product OR a program, not both"));
  }
  next();
});

const TrainingProgram   = mongoose.model("TrainingProgram",   trainingProgramSchema);
const EmployeeTraining  = mongoose.model("EmployeeTraining",  employeeTrainingSchema);
const ComplianceLog     = mongoose.model("ComplianceLog",     complianceLogSchema);
const QuizQuestion      = mongoose.model("QuizQuestion",      quizQuestionSchema);

module.exports = { TrainingProgram, EmployeeTraining, ComplianceLog, QuizQuestion };