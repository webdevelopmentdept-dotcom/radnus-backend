const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/hrSettingsController");
const leaveCtrl = require("../controllers/leaveController"); // ✅ already added
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");
// Shift
router.get("/shift", ctrl.getShift);
router.post("/shift", auth, hrOnly, ctrl.saveShift);

// Leave Types
router.get("/leave-types", ctrl.getLeaveTypes);
router.post("/leave-types", auth, hrOnly, ctrl.addLeaveType);
router.put("/leave-types", auth, hrOnly, ctrl.updateLeaveTypes);
router.delete("/leave-types/:id", auth, hrOnly, ctrl.deleteLeaveType);


// Holidays
router.get("/holidays", ctrl.getHolidays);
router.post("/holidays", auth, hrOnly, ctrl.addHoliday);
router.delete("/holidays/:id", auth, hrOnly, ctrl.deleteHoliday);

module.exports = router;