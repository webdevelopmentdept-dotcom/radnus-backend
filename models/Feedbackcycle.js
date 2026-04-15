// models/feedbackCycle.model.js

const mongoose = require("mongoose");

const feedbackCycleSchema = new mongoose.Schema(
  {
    cycleName: {
      type: String,
      required: true,
      trim: true,
    },
    period: {
      type: String,
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    reviewerConfig: {
      manager:      { type: Boolean, default: true },
      peers:        { type: Boolean, default: true },
      subordinates: { type: Boolean, default: true },
      self:         { type: Boolean, default: true },
    },
    weightage: {
      manager:      { type: Number, default: 40 },
      peers:        { type: Number, default: 25 },
      subordinates: { type: Number, default: 20 },
      self:         { type: Number, default: 15 },
    },
    peerCount: {
      type: Number,
      default: 2,
    },
    subCount: {
      type: Number,
      default: 1,
    },
    selectedEmployees: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Employee",
      },
    ],
    status: {
      type: String,
      enum: ["draft", "active", "completed"],
      default: "active",
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HR",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("FeedbackCycle", feedbackCycleSchema);