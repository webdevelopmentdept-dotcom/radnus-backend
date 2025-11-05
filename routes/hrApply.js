const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const HrApplicant = require("../models/HrApplicant");

// ✅ Cloudinary Storage Setup
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "resumes", // Folder name in Cloudinary
    resource_type: "raw", // Allows PDF, DOC, DOCX etc
  },
});

const upload = multer({ storage });

// ✅ Route: Apply for HR Job (with resume upload)
router.post("/apply", upload.single("resume"), async (req, res) => {
  try {
    const { name, email, phone, address, jobTitle } = req.body;

    // ✅ Create new applicant with Cloudinary file URL
    const newApplicant = new HrApplicant({
      name,
      email,
      phone,
      address,
      jobTitle,
      resumeURL: req.file.path, // ✅ Cloudinary permanent link
    });

    await newApplicant.save();

    res.status(201).json({
      success: true,
      message: "Application submitted successfully!",
      fileUrl: req.file.path, // For frontend confirmation
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: "Error submitting application",
      error: error.message,
    });
  }
});

module.exports = router;
