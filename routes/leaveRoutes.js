const express   = require("express");
const router    = express.Router();
const auth      = require("../middleware/auth");
const leaveCtrl = require("../controllers/leaveController");

const hrOnly = (req, res, next) => {
  if (req.user && ["hr", "admin"].includes(req.user.role)) return next();
  return res.status(403).json({ success: false, message: "HR only" });
};

router.use(auth);

router.post("/",                    leaveCtrl.createLeaveRequest);
router.get("/employee/:employeeId", leaveCtrl.getEmployeeLeaves);
router.get("/balance/:empId",       leaveCtrl.getLeaveBalance);
router.get("/team-requests",        leaveCtrl.getTeamLeaves);            // TL
router.get("/",                     hrOnly, leaveCtrl.getAllLeaves);     // HR

router.put("/:id/tl-approve",       leaveCtrl.tlApproveLeave);           // TL
router.put("/:id/tl-reject",        leaveCtrl.tlRejectLeave);            // TL
router.put("/:id/approve",          hrOnly, leaveCtrl.approveLeave);     // HR
router.put("/:id/reject",           hrOnly, leaveCtrl.rejectLeave);      // HR
router.delete("/:id",               leaveCtrl.cancelLeaveRequest);

module.exports = router;