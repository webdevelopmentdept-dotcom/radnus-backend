// routes/advanceRoutes.js
const express = require("express");
const router = express.Router();
const advanceCtrl = require("../controllers/advanceController");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");

// Employee self-service
router.post("/request",                 advanceCtrl.requestAdvance);
router.get("/employee/:employeeId",      advanceCtrl.getEmployeeAdvances);
router.delete("/:id",                    advanceCtrl.deleteAdvance);

// HR
router.get("/all", auth, hrOnly,                     advanceCtrl.getAllAdvances);
router.put("/:id/approve", auth, hrOnly,              advanceCtrl.approveAdvance);
router.put("/:id/reject", auth, hrOnly,               advanceCtrl.rejectAdvance);

module.exports = router;