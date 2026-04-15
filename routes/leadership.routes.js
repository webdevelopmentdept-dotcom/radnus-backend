const express    = require("express");
const router     = express.Router();
const {
  enrollEmployee,
  getAllTracks,
  getTrackByEmployee,
  updateTrack,
  withdrawTrack,
} = require("../controllers/leadershipController");

router.get("/",                    getAllTracks);
router.post("/",                   enrollEmployee);
router.get("/employee/:employeeId", getTrackByEmployee);
router.put("/:id",                 updateTrack);
router.delete("/:id",              withdrawTrack);

module.exports = router;