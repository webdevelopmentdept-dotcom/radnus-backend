// models/AssignGrade.js

const mongoose = require("mongoose");

const GradeHistorySchema = new mongoose.Schema({
  grade_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Grade",
    required: true
  },
  grade_level:        { type: String },
  grade_designation:  { type: String },
  bgr_stage:          { type: String },
  effective_date:     { type: Date },
  changed_at:         { type: Date, default: Date.now },
  change_type:        { type: String, enum: ["initial", "promote", "demote", "lateral"], default: "initial" },
  reason:             { type: String, default: "" },
  salary_scale_point: { type: String, enum: ["min", "mid", "max", ""], default: "" }, // ✅ ADD
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
  salary_scale_point: { type: String, enum: ["min", "mid", "max", ""], default: "" }, // ✅ ADD

  grade_history: [GradeHistorySchema],

}, { timestamps: true });

module.exports = mongoose.model("AssignGrade", AssignGradeSchema);