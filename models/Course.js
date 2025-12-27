const mongoose = require("mongoose");

const CourseSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    fee: { type: String, required: true },
    duration: { type: String, required: true },
    mode: { type: String, required: true },

    curriculum: { type: [String], default: [] },
    eligibility: { type: [String], default: [] },

    // FIX ⬇⬇⬇  (must be ARRAY for your UI)
    benefits: { type: [String], default: [] },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Course", CourseSchema);
