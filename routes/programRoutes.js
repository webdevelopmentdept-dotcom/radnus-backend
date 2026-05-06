const express = require("express");
const router  = express.Router();
const Program = require("../models/Program");

// GET all
router.get("/", async (req, res) => {
  try {
    const programs = await Program.find({ is_active: true }).sort({ createdAt: -1 });
    res.json({ success: true, data: programs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST add new
router.post("/", async (req, res) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Name required" });
    const existing = await Program.findOne({ name });
    if (existing) return res.status(400).json({ success: false, message: "Already exists" });
    const program = new Program({ name });
    await program.save();
    res.status(201).json({ success: true, data: program });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete("/:id", async (req, res) => {
  try {
    await Program.findByIdAndUpdate(req.params.id, { is_active: false });
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;