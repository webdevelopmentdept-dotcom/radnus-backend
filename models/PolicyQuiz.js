// models/PolicyQuiz.js
const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  question: { type: String, required: true },
  options: [{ type: String, required: true }], // 4 options
  correct_index: { type: Number, required: true }, // 0-3
});

const policyQuizSchema = new mongoose.Schema(
  {
    policy_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
      unique: true, // one quiz set per policy
    },
    questions: [questionSchema], // HR adds up to 15
    timer_seconds: { type: Number, default: 300 }, // 5 min default, HR can set
    pass_score: { type: Number, default: 3 }, // min correct out of 5 to pass
    is_active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("PolicyQuiz", policyQuizSchema);