const mongoose = require("mongoose");

const gradeSchema = new mongoose.Schema(
  {
    level: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
    },
    designation: {
      type: String,
      required: true,
      trim: true,
    },
    experience_range: {
      type: String,
      required: true,
      trim: true,
    },
    core_responsibility: {
      type: String,
      default: "",
      trim: true,
    },
    performance_expectation: {
      type: String,
      default: "",
      trim: true,
    },
    bgr_stage: {
      type: String,
      required: true,
      enum: ["Build", "Grow", "Retain"],
      default: "Build",
    },
    salary_band_min: {
      type: Number,
      default: null,
    },
    salary_band_mid: {      // ✅ இதை add பண்ணுங்க
  type: Number,
  default: null,
},

    salary_band_max: {
      type: Number,
      default: null,
    },
    notes: {
      type: String,
      default: "",
      trim: true,
    },
    is_active: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Grade", gradeSchema);