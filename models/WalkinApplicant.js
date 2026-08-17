const mongoose = require("mongoose");

const walkinApplicantSchema = new mongoose.Schema({
  requisitionDate:   { type: Date,   default: null },
  interviewDate:     { type: Date,   default: null },
  name:              { type: String, required: true },
  department:        { type: String, default: "" },
  designation:       { type: String, default: "" },
  mobile:            { type: String, required: true },
  emergencyContact:  { type: String, default: "" },
  location:          { type: String, default: "" },
  source: {
    type: String,
    enum: ["Naukri", "Indeed", "LinkedIn", "Referral", "Walk-in Direct", "Others"],
    default: "Walk-in Direct",
  },
  status: {
    type: String,
    enum: ["New", "Shortlisted", "Interview", "Hired", "Rejected"],
    default: "New",
  },
  receivedBy:        { type: String, default: "" },
  remarks:           { type: String, default: "" },
  rejectionReason:   { type: String, default: null },

  createdAt:         { type: Date, default: Date.now },
});

module.exports = mongoose.model("WalkinApplicant", walkinApplicantSchema);