const express   = require("express");
const router    = express.Router();
const leaveCtrl = require("../controllers/leaveController");

router.post("/",                    leaveCtrl.createLeaveRequest);
router.get("/employee/:employeeId", leaveCtrl.getEmployeeLeaves);
router.get("/",                     leaveCtrl.getAllLeaves);
router.put("/:id/approve",          leaveCtrl.approveLeave);
router.put("/:id/reject",           leaveCtrl.rejectLeave);
router.get("/balance/:empId",       leaveCtrl.getLeaveBalance);
router.delete("/:id",               leaveCtrl.cancelLeaveRequest); // ✅ Fix

module.exports = router;