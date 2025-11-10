const express = require("express");
const router = express.Router();
const Applicant = require("../models/Applicant");

// ✅ Add new academy applicant
router.post("/", async (req, res) => {
  try {
    const applicant = new Applicant(req.body);
    await applicant.save();
    res.json({ success: true, msg: "Academy applicant added successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Get all academy applicants (sorted by newest)
router.get("/", async (req, res) => {
  try {
    const applicants = await Applicant.find().sort({ createdAt: -1 });
    res.json({ success: true, applicants });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Get one applicant by ID
router.get("/:id", async (req, res) => {
  try {
    const applicant = await Applicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, applicant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Update applicant (for future use)
router.put("/:id", async (req, res) => {
  try {
    const updatedApplicant = await Applicant.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updatedApplicant) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, msg: "Applicant updated successfully!", applicant: updatedApplicant });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Delete applicant
router.delete("/:id", async (req, res) => {
  try {
    const deletedApplicant = await Applicant.findByIdAndDelete(req.params.id);
    if (!deletedApplicant) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, msg: "Applicant deleted successfully!" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
