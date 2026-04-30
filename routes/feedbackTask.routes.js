const express = require("express");
const router = express.Router();
const FeedbackTask = require("../models/FeedbackTask");


router.get("/:employeeId", async (req, res) => {
  try {
    const tasks = await FeedbackTask.find({
      reviewerId: req.params.employeeId,
    })
      .populate("revieweeId", "name department")
      .populate("cycleId", "cycleName");

    res.json({ success: true, data: tasks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: "Error fetching tasks" });
  }
});

module.exports = router;