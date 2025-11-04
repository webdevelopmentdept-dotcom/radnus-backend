const express = require("express");
const router = express.Router();
const Applicant = require("../models/Applicant");

// Add a new academy applicant
router.post("/", async (req, res) => {
  try {
    const applicant = new Applicant(req.body);
    await applicant.save();
    res.json({ success: true, msg: "Academy applicant added successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Get all academy applicants
router.get("/", async (req, res) => {
  try {
    const applicants = await Applicant.find().sort({ createdAt: -1 });
    res.json({ success: true, applicants });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
