const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const HrApplicant = require("../models/HrApplicant");

// ✅ Cloudinary storage
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "resumes",
    resource_type: "auto",
    public_id: (req, file) => file.originalname.split(".")[0],
  },
});

const upload = multer({ storage });

// ✅ Route for HR form submission
router.post("/", upload.single("resume"), async (req, res) => {
  try {
    const { name, email, phone, address, jobTitle } = req.body;

    if (!req.file) {
      return res.status(400).json({ success: false, msg: "Resume upload failed" });
    }

    const newApplicant = new HrApplicant({
      name,
      email,
      phone,
      address,
      jobTitle,
      resumeUrl: req.file.path || req.file.url, // ✅ corrected
    });

    await newApplicant.save();

    res.status(200).json({
      success: true,
      msg: "Application submitted successfully!",
      fileURL: req.file.path || req.file.url,
    });
  } catch (err) {
    console.error("Upload error:", err);
    res.status(500).json({ success: false, msg: "Upload failed" });
  }
});

module.exports = router;
