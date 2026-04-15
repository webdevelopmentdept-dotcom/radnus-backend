// models/AssignGrade.js — UPDATED with grade history

const mongoose = require("mongoose");

const GradeHistorySchema = new mongoose.Schema({
  grade_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Grade",
    required: true
  },
  grade_level:      { type: String },   // snapshot: e.g. "L3"
  grade_designation:{ type: String },   // snapshot: e.g. "Assistant Manager"
  bgr_stage:        { type: String },   // snapshot: "Build" / "Grow" / "Retain"
  effective_date:   { type: Date },
  changed_at:       { type: Date, default: Date.now },
  change_type:      { type: String, enum: ["initial", "promote", "demote", "lateral"], default: "initial" },
  reason:           { type: String, default: "" },
}, { _id: true });

const AssignGradeSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
  },
  grade_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Grade",
    required: true,
  },
  effective_date: {
    type: Date,
    required: true,
  },
  // ── Grade change history ──────────────────────────────────
  grade_history: [GradeHistorySchema],

}, { timestamps: true });

module.exports = mongoose.model("AssignGrade", AssignGradeSchema);