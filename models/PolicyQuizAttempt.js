// models/PolicyQuizAttempt.js
const mongoose = require("mongoose");

const policyQuizAttemptSchema = new mongoose.Schema(
  {
    policy_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Policy",
      required: true,
    },
    employee_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    version_number: { type: Number, required: true },
    questions_served: [
      {
        question: String,
        options: [String],
        correct_index: Number,
        employee_answer: Number, // null if not answered / timed out
      },
    ],
    score: { type: Number, default: 0 },
    passed: { type: Boolean, default: false },
    time_taken_seconds: { type: Number, default: 0 },
    completed: { type: Boolean, default: false }, // false = timed out
  },
  { timestamps: true }
);

// One attempt record per policy+employee+version (latest attempt overwrites)
policyQuizAttemptSchema.index(
  { policy_id: 1, employee_id: 1, version_number: 1 },
  { unique: false }
);

module.exports = mongoose.model("PolicyQuizAttempt", policyQuizAttemptSchema);