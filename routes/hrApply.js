const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const HrApplicant = require("../models/HrApplicant");

// ✅ Cloudinary Storage Configuration
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "resumes",
    resource_type: "raw",  // 👈 This is the KEY
    public_id: file.originalname.split(".")[0],
  }),
});

const upload = multer({ storage });

// ✅ Apply Route
router.post("/apply", upload.single("resume"), async (req, res) => {
  try {
    const { name, email, phone, address, jobTitle, location, about } = req.body;

    if (!req.file || !req.file.path) {
      return res.status(400).json({ success: false, msg: "Resume upload failed" });
    }

    const newApplicant = new HrApplicant({
      name,
      email,
      phone,
      address,
      jobTitle,
      location,
      about,
      resumeUrl: req.file.path,  // 👈 Cloudinary URL (raw file)
    });

    await newApplicant.save();

    res.status(200).json({
      success: true,
      msg: "Application submitted successfully!",
      fileURL: req.file.path,
    });
  } catch (error) {
    console.error("❌ Upload error:", error);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
