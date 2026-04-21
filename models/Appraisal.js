const mongoose = require("mongoose");

const appraisalSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    period_from: {
      type: Date,
      required: true,
    },

    period_to: {
      type: Date,
      required: true,
    },

    appraisal_type: {
      type: String,
      enum: ["Annual", "Half-Yearly", "Quarterly", "Probation", "Special"],
      default: "Annual",
    },

    employee_id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },

    // Auto-pulled from Performance Reviews
    performance_score: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // HR gives this manually
    hr_rating: {
      type: String,
      enum: ["Excellent", "Good", "Average", "Poor", ""],
      default: "",
    },

    // Increment % HR decides
    increment_percent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // Promotion details (optional)
    promotion: {
      type: Boolean,
      default: false,
    },

    new_designation: {
      type: String,
      default: "",
      trim: true,
    },

    // HR remarks
    remarks: {
      type: String,
      default: "",
      trim: true,
    },

    // Draft = HR still editing, Published = Employee can see
    status: {
      type: String,
      enum: ["Draft", "Published"],
      default: "Draft",
    },

    created_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HR",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Appraisal", appraisalSchema);