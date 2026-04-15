const mongoose = require("mongoose");
 
const retentionPlanSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      unique: true,   // one plan per employee
    },
    status: {
      type: String,
      enum: ["draft", "active", "under_review", "closed"],
      default: "draft",
    },
    approvedBy: { type: String, default: "" },   // CEO / CPO name
    approvedAt: { type: Date },
 
    // ── Plan Components (from Policy 3.38) ─────────────────────
    financialIncentives: {
      description: { type: String, default: "" },
      amount:       { type: String, default: "" },
      frequency:    { type: String, default: "" }, // quarterly / annual
      linkedTo:     { type: String, default: "" }, // business results
    },
    careerGrowth: {
      fastTrackedPromotion: { type: Boolean, default: false },
      leadershipGrooming:   { type: Boolean, default: false },
      crossFunctionalExposure: { type: Boolean, default: false },
      notes: { type: String, default: "" },
    },
    skillDevelopment: {
      externalCourses:   { type: Boolean, default: false },
      internalBootcamp:  { type: Boolean, default: false },
      radnusAcademyLMS:  { type: Boolean, default: false },
      certifications:    [{ type: String }],
      notes: { type: String, default: "" },
    },
    workFlexibility: {
      remoteWork:         { type: Boolean, default: false },
      flexibleHours:      { type: Boolean, default: false },
      projectBasedAutonomy: { type: Boolean, default: false },
      notes: { type: String, default: "" },
    },
    recognition: {
      boardLevelVisibility: { type: Boolean, default: false },
      townhallHighlight:    { type: Boolean, default: false },
      digitalLeaderboard:   { type: Boolean, default: false },
      esopEligible:         { type: Boolean, default: false },
      notes: { type: String, default: "" },
    },
    reviewFrequency: {
      type: String,
      enum: ["monthly","quarterly","bi-annual","annual"],
      default: "quarterly",
    },
    nextReviewDate: { type: Date },
    hrNotes:        { type: String, default: "" },
 
    // ── Review History ──────────────────────────────────────────
    reviewHistory: [
      {
        date:      { type: Date, default: Date.now },
        reviewedBy:{ type: String },
        outcome:   { type: String },
        notes:     { type: String },
      }
    ],
  },
  { timestamps: true }
);
 
module.exports = mongoose.model("RetentionPlan", retentionPlanSchema);