const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const HrApplicant = require("../models/HrApplicant");

// ✅ Cloudinary storage setup for resumes
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "resumes",
    resource_type: "raw",   // 👈 Forces Cloudinary to treat PDFs/DOCs correctly
    public_id: file.originalname.replace(/\.[^/.]+$/, ""),
  }),
});

const upload = multer({ storage });

router.post("/apply", upload.single("resume"), async (req, res) => {
  try {
    const { name, email, phone, address, jobTitle, location, about } = req.body;
    if (!req.file?.path)
      return res.status(400).json({ success: false, msg: "Resume upload failed" });

    const applicant = new HrApplicant({
      name,
      email,
      phone,
      address,
      jobTitle,
      location,
      about,
      resumeUrl: req.file.path, // this will now include /raw/upload/
    });

    await applicant.save();
    res.json({ success: true, msg: "Application submitted!", fileURL: req.file.path });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
