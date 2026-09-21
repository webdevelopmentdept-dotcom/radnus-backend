const mongoose = require("mongoose");

const internshipSchema = new mongoose.Schema({
  // ===== 1. Personal Details =====
  name:            { type: String, required: true },
  mobile:          { type: String, required: true },
  email:           { type: String, required: true },

  // ===== 2. Academic Details =====
  collegeAndYear:  { type: String, required: true },   // e.g. "SASTRA University - 3rd Year"
  cgpa:            { type: String, default: "" },

  // ===== 3. Core Interest =====
  coreArea:        { type: String, required: true },   // dropdown value

  // ===== 4. Internship Requirement =====
  duration:        { type: String, required: true },   // 1 Week / 2 Weeks / 1 Month / etc.
  mode:            { type: String, default: "" },       // On-site / Hybrid / Remote

  // ===== 5. Thinking / Screening question =====
  processImprovement: { type: String, required: true }, // "describe one process you'd improve"

  // ===== 6. Documents =====
  resumeUrl:       { type: String, required: true },

  // ===== 7. Declaration =====
  declarationAccepted: { type: Boolean, required: true, default: false },

  // ===================================================
  // INTERNAL — HR Screening / Project Allocation fields
  // (not filled by student, only by HR admin later)
  // ===================================================
  status: {
    type: String,
    enum: ["New", "Shortlisted", "Rejected", "Selected"],
    default: "New",
  },
  hrRemarks:        { type: String, default: "" },
  ratings: {
    communication:  { type: Number, default: null },
    academicProfile:{ type: Number, default: null },
    coreSkillRelevance: { type: Number, default: null },
    projectPotential:   { type: Number, default: null },
  },

  allocation: {
    department:        { type: String, default: "" },
    mentor:            { type: String, default: "" },
    projectTitle:      { type: String, default: "" },
    businessProblem:   { type: String, default: "" },
    expectedDeliverable:{ type: String, default: "" },
    startDate:         { type: Date, default: null },
    endDate:           { type: Date, default: null },
  },

  progress: [
    {
      week:    { type: String },  // "Week 1 - Orientation" etc.
      status:  { type: String, enum: ["Pending", "In Progress", "Done"], default: "Pending" },
      notes:   { type: String, default: "" },
      updatedAt: { type: Date, default: Date.now },
    },
  ],

  finalEvaluation: {
    presentationDone: { type: Boolean, default: false },
    reportUrl:        { type: String, default: "" },
    mentorFeedback:   { type: String, default: "" },
    certificateStatus:{ type: String, enum: ["Not Issued", "Issued"], default: "Not Issued" },
  },

  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Internship", internshipSchema);