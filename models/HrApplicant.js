const mongoose = require("mongoose");

const hrApplicantSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true },
  phone: { type: String, required: true },
  jobTitle: { type: String, required: true },
  resumeUrl: { type: String },
  createdAt: { type: Date, default: Date.now },
});

module.exports = mongoose.model("HrApplicant", hrApplicantSchema);
