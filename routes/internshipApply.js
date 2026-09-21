const express = require("express");
const router = express.Router();
const cloudinary = require("../config/cloudinary");
const Internship = require("../models/Internship");
const Notification = require("../models/Notification");

const HR_ID = "hr_admin_001";

// ── No multer / busboy here at all ──────────────────────────────────────
// The frontend converts the resume file to a base64 data URI (same pattern
// as HR Announcements' image upload — see src/pages/hr/Hrannouncements.jsx)
// and sends it as a normal JSON body. This sidesteps multipart parsing
// entirely, which is where the "Unexpected end of form" issue was coming
// from. express.json({ limit: "100mb" }) is already applied globally in
// server.js, so a base64-encoded resume (even up to ~10MB original file,
// ~13-14MB once base64-encoded) comfortably fits.

const MAX_RESUME_BYTES = 10 * 1024 * 1024; // 10MB cap, same as before

// Upload a base64 data URI straight to Cloudinary — no file buffer/stream involved
//
// IMPORTANT: for resource_type "raw" (PDF/DOC/DOCX etc.), Cloudinary does NOT
// auto-append a file extension the way it does for images/videos. Whatever
// extension is (or isn't) present in public_id is exactly what the delivered
// URL ends with. So we must KEEP the original extension here — stripping it
// (like the old code did) produces a URL with no extension, which is why
// browsers/Windows couldn't tell it was a PDF and just downloaded it as a
// generic file instead of previewing it.
const uploadBase64ToCloudinary = (base64DataUri, filename) => {
  // Sanitize the filename (keep the extension!) so it's a safe public_id —
  // strip anything that isn't a letter, digit, dot, dash, or underscore.
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  return cloudinary.uploader.upload(base64DataUri, {
    folder: "internship-resumes",
    resource_type: "raw",
    public_id: safeName,
    use_filename: true,
    unique_filename: true, // Cloudinary appends a random suffix to avoid collisions/overwrites
  });
};

// POST /api/internship/apply
router.post("/apply", async (req, res) => {
  try {
    const {
      name,
      mobile,
      email,
      collegeAndYear,
      cgpa,
      coreArea,
      duration,
      mode,
      processImprovement,
      declarationAccepted,
      resumeBase64,   // e.g. "data:application/pdf;base64,JVBERi0xLjQK..."
      resumeFilename, // e.g. "Harseetha Resume.pdf"
    } = req.body;

    // Basic required-field check
    if (!name || !mobile || !email || !collegeAndYear || !coreArea || !duration || !processImprovement) {
      return res.status(400).json({ success: false, msg: "Please fill all required fields." });
    }

    if (declarationAccepted !== true) {
      return res.status(400).json({ success: false, msg: "Please accept the declaration." });
    }

    if (!resumeBase64 || !resumeFilename) {
      return res.status(400).json({ success: false, msg: "Resume upload failed" });
    }

    // Rough size check on the base64 payload (base64 is ~33% larger than raw bytes)
    const approxBytes = Math.floor((resumeBase64.length * 3) / 4);
    if (approxBytes > MAX_RESUME_BYTES) {
      return res.status(400).json({ success: false, msg: "Resume file is too large. Please upload a file under 10MB." });
    }

    // Duplicate check — same email applying again
    const existing = await Internship.findOne({ email });
    if (existing) {
      return res.status(400).json({
        success: false,
        msg: "You have already submitted an internship application.",
      });
    }

    // Upload straight to Cloudinary — no multer/busboy involved at all
    let cloudinaryResult;
    try {
      cloudinaryResult = await uploadBase64ToCloudinary(resumeBase64, resumeFilename);
    } catch (uploadErr) {
      console.error("Cloudinary upload failed:", uploadErr.message);
      return res.status(500).json({ success: false, msg: "Resume upload failed. Please try again." });
    }

    const internship = new Internship({
      name,
      mobile,
      email,
      collegeAndYear,
      cgpa: cgpa || "",
      coreArea,
      duration,
      mode: mode || "",
      processImprovement,
      resumeUrl: cloudinaryResult.secure_url,
      declarationAccepted: true,
    });

    await internship.save();

    // Notify HR — same pattern as hrApply.js
    try {
      await Notification.create({
        recipient_id: HR_ID,
        recipient_role: "hr",
        type: "new_internship",
        title: "New Internship Application",
        message: `${name} applied for internship (${coreArea})`,
        link: "",
        isRead: false,
      });
    } catch (notifErr) {
      console.error("Notify HR (internship apply) failed:", notifErr.message);
    }

    res.json({ success: true, msg: "Internship application submitted!" });
  } catch (err) {
    console.error("Internship apply error:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;