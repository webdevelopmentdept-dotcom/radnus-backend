const mongoose = require("mongoose");

// ─── Training Program Master ──────────────────────────────────
const trainingProgramSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  level:       { type: String, enum: ["L1","L2","L3","L4","L5","L6","all"], default: "all" },
  department:  { type: String, default: "all" }, // "all" or specific dept
  type:        { type: String, enum: ["induction","job_role","cross_functional","culture","refresher","department","equipment"], default: "job_role" },
  modules:     [{ type: String }],

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

  status:       { type: String, enum: ["pending","in_progress","completed","overdue","waived","failed_retake","needs_hr_review","pending_review","retrain"], default: "pending" },
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
  action:      { type: String, enum: ["assigned","started","completed","overdue","score_updated","cert_issued","waived","retrain"] },
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