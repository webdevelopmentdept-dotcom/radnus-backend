const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const HrApplicant = require("../models/HrApplicant");

const router = express.Router();

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "../uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

// Multer setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname),
});
const upload = multer({ storage });

// POST /api/hr/apply
router.post("/apply", upload.single("resume"), async (req, res) => {
  try {
    const { name, email, phone, location, jobTitle } = req.body;

    if (!name || !email || !phone || !location || !jobTitle)
      return res.status(400).json({ success: false, msg: "All fields required" });

    const applicant = new HrApplicant({
      name,
      email,
      phone,
      address: location,
      jobTitle,
      resumeUrl: req.file ? `/uploads/${req.file.filename}` : null,
    });

    await applicant.save();
    res.json({ success: true, msg: "HR application submitted successfully!" });
  } catch (err) {
    console.error("Error in HR apply:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
