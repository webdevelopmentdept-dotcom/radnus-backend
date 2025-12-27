const express = require("express");
const router = express.Router();
const Update = require("../models/Update");

// GET all updates
router.get("/", async (req, res) => {
  const updates = await Update.find().sort({ createdAt: -1 });
  res.json({ success: true, updates });
});

// ADD update
router.post("/add", async (req, res) => {
  try {
    const { message } = req.body;
    const add = await Update.create({ message });
    res.json({ success: true, update: add });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

// DELETE update
router.delete("/delete/:id", async (req, res) => {
  try {
    await Update.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, message: err.message });
  }
});

module.exports = router;
