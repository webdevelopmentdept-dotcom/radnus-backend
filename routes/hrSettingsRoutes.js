const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/hrSettingsController");

// Shift
router.get("/shift",  ctrl.getShift);
router.post("/shift", ctrl.saveShift);

// Leave Types
router.get("/leave-types",        ctrl.getLeaveTypes);
router.post("/leave-types",       ctrl.addLeaveType);
router.put("/leave-types",        ctrl.updateLeaveTypes);
router.delete("/leave-types/:id", ctrl.deleteLeaveType);

// Holidays
router.get("/holidays",        ctrl.getHolidays);
router.post("/holidays",       ctrl.addHoliday);
router.delete("/holidays/:id", ctrl.deleteHoliday);

module.exports = router;