const mongoose = require("mongoose");

const leadershipTrackSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
    unique: true,
  },

  // ── Stage Info ─────────────────────────────────────────────
  stage: {
    type: Number,
    enum: [1, 2, 3, 4, 5],
    required: true,
    default: 1,
  },
  stageLabel: {
    type: String,
    default: "Emerging Leader",
  },
  targetRole: { type: String, default: "" },
  timeline:   { type: String, default: "" },
  focusAreas: [{ type: String }],
  expectedOutput: { type: String, default: "" },

  // ── Status ─────────────────────────────────────────────────
  status: {
    type: String,
    enum: ["active", "paused", "completed", "withdrawn"],
    default: "active",
  },
  isHiPo:     { type: Boolean, default: false },
  enrolledAt: { type: Date,    default: Date.now },

  // ── Mentorship ─────────────────────────────────────────────
  mentor: {
    name:       { type: String, default: "" },
    designation:{ type: String, default: "" },
    sessionFreq:{ type: String, default: "quarterly" },
    notes:      { type: String, default: "" },
  },

  // ── Rotational Exposure ────────────────────────────────────
  rotations: [{
    department: { type: String },
    duration:   { type: String },
    startDate:  { type: Date },
    endDate:    { type: Date },
    completed:  { type: Boolean, default: false },
    feedback:   { type: String, default: "" },
  }],

  // ── Skill Development ──────────────────────────────────────
  skillPrograms: {
    leadershipTraining:    { type: Boolean, default: false },
    financialManagement:   { type: Boolean, default: false },
    innovationProgram:     { type: Boolean, default: false },
    peopleManagement:      { type: Boolean, default: false },
    radnusCultureImmersion:{ type: Boolean, default: false },
    corporateAcademyLMS:   { type: Boolean, default: false },
    externalPrograms:      { type: Boolean, default: false },
    notes:                 { type: String,  default: "" },
  },

  // ── Performance ────────────────────────────────────────────
  performance: {
    okrScore:             { type: Number, default: 0 },
    lastAssessmentScore:  { type: Number, default: 0 },
    lastAssessmentDate:   { type: Date },
    nextAssessmentDate:   { type: Date },
    promotionEligible:    { type: Boolean, default: false },
    notes:                { type: String,  default: "" },
  },

  // ── Recognition ────────────────────────────────────────────
  recognition: {
    esopEligible:         { type: Boolean, default: false },
    impactBonusReceived:  { type: Boolean, default: false },
    publicRecognition:    { type: Boolean, default: false },
    hiPoTalentPool:       { type: Boolean, default: false },
    notes:                { type: String,  default: "" },
  },

  // ── Progress History ───────────────────────────────────────
  progressHistory: [{
    date:        { type: Date, default: Date.now },
    updatedBy:   { type: String },
    stageChanged:{ type: Boolean, default: false },
    fromStage:   { type: Number },
    toStage:     { type: Number },
    notes:       { type: String },
  }],

  hrNotes: { type: String, default: "" },

}, { timestamps: true });

module.exports = mongoose.model("LeadershipTrack", leadershipTrackSchema);