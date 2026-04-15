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
  status: {
    type: String,
    enum: ["active", "closed", "draft"],
    default: "active",
  },
  posted: { type: Date, default: Date.now },
});

module.exports = mongoose.model("Job", jobSchema);