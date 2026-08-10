// routes/advanceRoutes.js
const express = require("express");
const router = express.Router();
const advanceCtrl = require("../controllers/advanceController");

// Employee self-service
router.post("/request",                 advanceCtrl.requestAdvance);
router.get("/employee/:employeeId",      advanceCtrl.getEmployeeAdvances);
router.delete("/:id",                    advanceCtrl.deleteAdvance);

// HR
router.get("/all",                       advanceCtrl.getAllAdvances);
router.put("/:id/approve",               advanceCtrl.approveAdvance);
router.put("/:id/reject",                advanceCtrl.rejectAdvance);

module.exports = router;