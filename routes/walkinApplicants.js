const express = require("express");
const router = express.Router();
const WalkinApplicant = require("../models/WalkinApplicant");

// ✅ Add new walk-in applicant
router.post("/", async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile || !/^\d{10}$/.test(String(mobile).trim())) {
      return res.status(400).json({
        success: false,
        msg: "Mobile No must be exactly 10 digits.",
      });
    }

    const applicant = new WalkinApplicant(req.body);
    await applicant.save();
    res.json({ success: true, msg: "Walk-in applicant added successfully!", applicant });
  } catch (err) {
    console.error("Error adding walk-in applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Get all walk-in applicants (sorted by newest)
router.get("/", async (req, res) => {
  try {
    const applicants = await WalkinApplicant.find().sort({ createdAt: -1 });
    res.json({ success: true, applicants });
  } catch (err) {
    console.error("Error fetching walk-in applicants:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Get one walk-in applicant by ID
router.get("/:id", async (req, res) => {
  try {
    const applicant = await WalkinApplicant.findById(req.params.id);
    if (!applicant) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, applicant });
  } catch (err) {
    console.error("Error fetching walk-in applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Update full applicant details
router.put("/:id", async (req, res) => {
  try {
    const updated = await WalkinApplicant.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, msg: "Walk-in applicant updated successfully!", applicant: updated });
  } catch (err) {
    console.error("Error updating walk-in applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Update status only (New / Shortlisted / Interview / Hired / Rejected)
router.put("/:id/status", async (req, res) => {
  try {
    const { status, rejectionReason } = req.body;
    const update = { status };
    if (rejectionReason) update.rejectionReason = rejectionReason;

    const updated = await WalkinApplicant.findByIdAndUpdate(
      req.params.id,
      update,
      { new: true }
    );
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, msg: "Status updated!", applicant: updated });
  } catch (err) {
    console.error("Error updating walk-in status:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// ✅ Delete walk-in applicant
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await WalkinApplicant.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, msg: "Applicant not found" });
    }
    res.json({ success: true, msg: "Walk-in applicant deleted successfully!" });
  } catch (err) {
    console.error("Error deleting walk-in applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;