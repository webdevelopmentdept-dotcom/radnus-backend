const mongoose = require("mongoose");

const hrApplicantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  jobTitle: { type: String, required: true },
  resumeUrl: { type: String },
  createdAt: { type: Date, default: Date.now },
  status: {
  type: String,
  enum: ["New", "Shortlisted", "Interview", "Hired", "Rejected"],
  default: "New",
},

// ✅ AI Screening fields — இதை add பண்ணு
  aiScore: { type: Number, default: null },
  aiGrade: { type: String, default: null },   // A / B / C
  aiReason: { type: String, default: null },
  aiScreenedAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now },
  
});

module.exports = mongoose.model("HrApplicant", hrApplicantSchema);
