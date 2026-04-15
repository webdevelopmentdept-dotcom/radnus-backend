const mongoose = require("mongoose");

// ─── Training Program Master ──────────────────────────────────
const trainingProgramSchema = new mongoose.Schema({
  title:       { type: String, required: true },
  level:       { type: String, enum: ["L1","L2","L3","L4","L5","L6","all"], default: "all" },
  department:  { type: String, default: "all" }, // "all" or specific dept
  type:        { type: String, enum: ["induction","job_role","cross_functional","culture","refresher","department"], default: "job_role" },
  modules:     [{ type: String }],
  duration:    { type: String, default: "" },       // "7 Days", "1 Month", etc.
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

  status:       { type: String, enum: ["pending","in_progress","completed","overdue","waived"], default: "pending" },
  assignedDate: { type: Date, default: Date.now },
  dueDate:      { type: Date },
  startedDate:  { type: Date },
  completedDate:{ type: Date },

  assessmentScore: { type: Number, default: null }, // post-training score %
  certificationIssued: { type: Boolean, default: false },
  certificationDate:   { type: Date },

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
  action:      { type: String, enum: ["assigned","started","completed","overdue","score_updated","cert_issued","waived"] },
  note:        { type: String, default: "" },
  addedBy:     { type: String, default: "HR" },
  date:        { type: Date, default: Date.now },
}, { timestamps: true });

const TrainingProgram   = mongoose.model("TrainingProgram",   trainingProgramSchema);
const EmployeeTraining  = mongoose.model("EmployeeTraining",  employeeTrainingSchema);
const ComplianceLog     = mongoose.model("ComplianceLog",     complianceLogSchema);

module.exports = { TrainingProgram, EmployeeTraining, ComplianceLog };