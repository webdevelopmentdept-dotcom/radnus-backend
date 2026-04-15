// const express = require('express');
// const router = express.Router();
// const WellnessSession = require('../models/Wellness');

// // POST
// router.post('/', async (req, res) => {
//   const session = new WellnessSession(req.body);
//   await session.save();
//   res.status(201).json({ success: true, data: session });
// });

// // GET
// router.get('/employee/:employeeId', async (req, res) => {
//   const sessions = await WellnessSession.find({
//     employee_id: req.params.employeeId
//   });
//   res.json({ success: true, data: sessions });
// });

// // DELETE
// router.delete('/:id', async (req, res) => {
//   await WellnessSession.findByIdAndDelete(req.params.id);
//   res.json({ success: true });
// });

// // FEEDBACK
// router.put('/:id/feedback', async (req, res) => {
//   const session = await WellnessSession.findById(req.params.id);
//   session.feedback_score = req.body.feedback_score;
//   session.feedback_comment = req.body.feedback_comment;
//   await session.save();

//   res.json({ success: true, data: session });
// });

// module.exports = router;

const express = require("express");
const router = express.Router();
const WellnessSession = require("../models/Wellness");

// ✅ CREATE SESSION
router.post("/", async (req, res) => {
  try {
    const session = new WellnessSession(req.body);
    await session.save();
    res.status(201).json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ GET BY EMPLOYEE ID
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const sessions = await WellnessSession.find({
      employee_id: req.params.employeeId,
    });
    res.json({ success: true, data: sessions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ DELETE SESSION
router.delete("/:id", async (req, res) => {
  try {
    await WellnessSession.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

// ✅ ADD FEEDBACK
router.put("/:id/feedback", async (req, res) => {
  try {
    const session = await WellnessSession.findById(req.params.id);

    if (!session) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    session.feedback_score = req.body.feedback_score;
    session.feedback_comment = req.body.feedback_comment;

    await session.save();

    res.json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false });
  }
});

module.exports = router;