const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema({
  title: { type: String, required: true },
  type: { type: String, required: true },
  duration: { type: String, required: true },
  experience: { type: String, required: true },
  salary: { type: String, default: "N/A" },
  description: { type: String, required: true },
  responsibilities: [{ type: String }],
  requirements: [{ type: String }],
  schedule: { type: String, default: "Day shift" },
  workLocation: { type: String, default: "In-person" },
  contactDetails: { type: String },
  visibility: { type: String, enum: ["public", "internal"], default: "public" },
  minExperience: { type: Number, default: 0 },
   applicants: [{
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
    appliedAt:  { type: Date, default: Date.now },
    status: {
      type: String,
      enum: ["applied", "under_review", "interview", "selected", "rejected"],
      default: "applied"
    }
  }],
  status: {
    type: String,
    enum: ["active", "closed", "draft"],
    default: "active",
  },
  posted: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Job", jobSchema);