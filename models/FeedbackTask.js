const mongoose = require("mongoose");

const feedbackTaskSchema = new mongoose.Schema(
  {
    cycleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "FeedbackCycle",
    },
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    revieweeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
    },
    reviewerType: {
      type: String,
      enum: ["manager", "peer", "subordinate", "self"],
    },
    // ✅ FIXED — SUBMITTED → COMPLETED (submission route-லயும் COMPLETED use பண்றோம்)
    status: {
      type: String,
      enum: ["PENDING", "COMPLETED"],
      default: "PENDING",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FeedbackTask", feedbackTaskSchema);