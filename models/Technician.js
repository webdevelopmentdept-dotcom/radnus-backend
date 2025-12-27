const mongoose = require("mongoose");

const TechnicianSchema = new mongoose.Schema(
  {
    fullName: String,
    mobile: String,
    address: String,
    district: String,
    taluk: String,
    experience: String,

    skills: [String],
    brands: [String],
    tools: [String],

    jobType: String,
    paymentType: String,

    expectedSalary: Number,  

    workLocation: String,
    joinReady: String,

    radnusAgree: String,
    remarks: String,

    status: { type: String, default: "New" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Technician", TechnicianSchema);
