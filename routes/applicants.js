const express = require("express");
const router = express.Router();
const Applicant = require("../models/Applicant");

// ✅ POST new applicant (public)
router.post("/", async (req, res) => {
  try {
    const { name, email, phone, address, course } = req.body;
    const newApplicant = new Applicant({ name, email, phone, address, course });
    const saved = await newApplicant.save();
    res.status(201).json({ success: true, applicant: saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server Error" });
  }
});

// ✅ GET all applicants (no token check)
router.get("/", async (req, res) => {
  try {
    const applicants = await Applicant.find().sort({ createdAt: -1 });
    res.status(200).json({ success: true, applicants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server Error" });
  }
});

module.exports = router;
