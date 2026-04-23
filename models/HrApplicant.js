const mongoose = require("mongoose");

const hrApplicantSchema = new mongoose.Schema({
  name:         { type: String, required: true },
  email:        { type: String, required: true },
  phone:        { type: String, required: true },
  jobTitle:     { type: String, required: true },
  location:     { type: String, default: "" },
  address:      { type: String, default: "" },
  about:        { type: String, default: "" },
  aadhaarLast4: { type: String, default: "" },   // candidate unique identification
  resumeUrl:    { type: String },
  status: {
    type: String,
    enum: ["New", "Shortlisted", "Interview", "Hired", "Rejected"],
    default: "New",
  },

  // AI Screening fields
  aiScore:      { type: Number, default: null },
  aiGrade:      { type: String, default: null },   // A / B / C
  aiReason:     { type: String, default: null },
  aiScreenedAt: { type: Date,   default: null },

  createdAt:    { type: Date, default: Date.now },  // duplicate remove panniten
});

module.exports = mongoose.model("HrApplicant", hrApplicantSchema);