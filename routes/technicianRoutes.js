const express = require("express");
const router = express.Router();
const Technician = require("../models/Technician");

/* CREATE */
router.post("/", async (req, res) => {
  try {
    const tech = new Technician(req.body);
    await tech.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

/* GET ALL */
router.get("/", async (req, res) => {
  const data = await Technician.find().sort({ createdAt: -1 });
  res.json(data);
});

/* UPDATE STATUS */
router.put("/status/:id", async (req, res) => {
  await Technician.findByIdAndUpdate(req.params.id, {
    status: req.body.status,
  });
  res.json({ success: true });
});

/* DELETE */
router.delete("/:id", async (req, res) => {
  await Technician.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});

module.exports = router;
