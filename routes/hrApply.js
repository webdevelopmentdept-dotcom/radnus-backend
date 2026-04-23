const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const HrApplicant = require("../models/HrApplicant");
const Job = require("../models/Job");
const { screenApplicant } = require("../helpers/aiScreening");

// Cloudinary storage setup for resumes
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "resumes",
    resource_type: "raw",
    public_id: file.originalname.replace(/\.[^/.]+$/, ""),
  }),
});

const upload = multer({ storage });

router.post("/apply", upload.single("resume"), async (req, res) => {
  try {
    const { name, email, phone, address, jobTitle, location, about, aadhaarLast4 } = req.body;

    // Already applied check — email + jobTitle
    const existing = await HrApplicant.findOne({ email, jobTitle });
    if (existing) {
      return res.status(400).json({
        success: false,
        msg: "You have already applied for this position.",
      });
    }

    // Aadhaar last 4 digits validation
    if (!aadhaarLast4 || aadhaarLast4.trim().length !== 4 || !/^\d{4}$/.test(aadhaarLast4)) {
      return res.status(400).json({
        success: false,
        msg: "Aadhaar last 4 digits required.",
      });
    }

    if (!req.file?.path)
      return res.status(400).json({ success: false, msg: "Resume upload failed" });

    // Applicant save
    const applicant = new HrApplicant({
      name,
      email,
      phone,
      address,
      jobTitle,
      location,
      about,
      aadhaarLast4: aadhaarLast4.trim(),
      resumeUrl: req.file.path,
    });
    await applicant.save();

    // Candidate-ku immediate response
    res.json({ success: true, msg: "Application submitted!", fileURL: req.file.path });

    // Background-la AI screening (response delay varathu)
    try {
      const job = await Job.findOne({ title: jobTitle });
      if (job) {
        const aiResult = await screenApplicant(applicant, job);
        await HrApplicant.findByIdAndUpdate(applicant._id, aiResult);
        console.log(`✅ AI Screened: ${name} — Score: ${aiResult.aiScore} | Grade: ${aiResult.aiGrade}`);
      } else {
        console.log(`⚠️ Job not found for AI screening: ${jobTitle}`);
      }
    } catch (aiErr) {
      console.error("❌ AI screening failed:", aiErr.message);
    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;