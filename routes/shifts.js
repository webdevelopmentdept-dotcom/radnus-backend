const express = require("express");
const router  = express.Router();
const Shift   = require("../models/Shift");

router.get("/", async (req, res) => {
  try {
    let shifts = await Shift.find().sort({ createdAt: 1 });
    if (shifts.length === 0) {
      shifts = await Shift.insertMany([
        { name: "General",   startTime: "09:45", endTime: "19:00" },
        { name: "Morning",   startTime: "06:00", endTime: "14:00" },
        { name: "Afternoon", startTime: "14:00", endTime: "22:00" },
        { name: "Night",     startTime: "22:00", endTime: "06:00" },
      ]);
    }
    res.json({ data: shifts });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.post("/", async (req, res) => {
  try {
    const shift = await Shift.create(req.body);
    res.json({ data: shift });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.put("/:id", async (req, res) => {
  try {
    const shift = await Shift.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ data: shift });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

router.delete("/:id", async (req, res) => {
  try {
    await Shift.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ message: err.message }); }
});

module.exports = router;