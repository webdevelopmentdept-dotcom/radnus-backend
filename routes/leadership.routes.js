const express = require("express");
const router = express.Router();
const {
  enrollEmployee,
  getAllTracks,
  getTrackByEmployee,
  updateTrack,
  withdrawTrack,
} = require("../controllers/leadershipController");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");

router.get("/", auth, hrOnly, getAllTracks);
router.post("/", auth, hrOnly, enrollEmployee);
router.get("/employee/:employeeId", auth, hrOnly, getTrackByEmployee);
router.put("/:id", auth, hrOnly, updateTrack);
router.delete("/:id", auth, hrOnly, withdrawTrack);

module.exports = router;