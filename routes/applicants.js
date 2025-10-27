const express = require("express");
const router = express.Router();
const Applicant = require("../models/Applicant");

router.post("/", async (req, res) => {
  try {
    const applicant = new Applicant(req.body);
    await applicant.save();
    res.json({ success: true, msg: "Applicant added successfully!" });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

router.get("/", async (req, res) => {
  try {
    const applicants = await Applicant.find();
    res.json({ success: true, applicants });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
