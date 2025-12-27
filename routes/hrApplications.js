const express = require("express");
const router = express.Router();
const HrApplicant = require("../models/HrApplicant");

// ✅ Get all HR job applications
router.get("/applications", async (req, res) => {
  try {
    const applications = await HrApplicant.find().sort({ createdAt: -1 });
    res.json({ success: true, applications });
  } catch (err) {
    console.error("Error fetching HR applications:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Delete HR applicant by ID
router.delete("/applications/:id", async (req, res) => {
  try {
    const deleted = await HrApplicant.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, msg: "HR applicant deleted successfully!" });
  } catch (err) {
    console.error("Error deleting HR applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
