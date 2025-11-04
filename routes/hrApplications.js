const express = require("express");
const router = express.Router();
const HrApplicant = require("../models/HrApplicant");

router.get("/applications", async (req, res) => {
  try {
    const applications = await HrApplicant.find().sort({ createdAt: -1 });
    res.json({ success: true, applications });
  } catch (err) {
    console.error("Error fetching HR applications:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;
