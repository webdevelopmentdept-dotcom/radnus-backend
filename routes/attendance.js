const express = require("express");
const router  = express.Router();
const Attendance = require("../models/Attendance");
const Employee   = require("../models/Employee");

const {
  checkIn, checkOut, breakStart, breakEnd,
  getTodayRecord, getSummary, getMonthlyRecords,
  getDailyReport, getMonthlyReport,
  hrMarkAttendance, exportExcel,
} = require("../controllers/attendanceController");

const {
  createLeaveRequest, getEmployeeLeaves,
  getAllLeaves, approveLeave, rejectLeave,
} = require("../controllers/leaveController");

// ✅ இது முதல்ல வேணும் — HR Dashboard today stats
router.get("/attendance/today", async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];

    const records   = await Attendance.find({ date: today });
    const employees = await Employee.find({ status: "approved" });

    const present = records.filter(r => r.status === "present").length;
    const late    = records.filter(r => r.status === "late").length;
    const onLeave = records.filter(r => r.status === "leave").length;
    const absent  = Math.max(employees.length - present - late - onLeave, 0);

    res.json({ present, absent, late, onLeave });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ இது கீழே வேணும் — Employee specific
router.get("/attendance/today/:employeeId", getTodayRecord);

router.post("/attendance/check-in",            checkIn);
router.post("/attendance/check-out",           checkOut);
router.post("/attendance/break-start",         breakStart);
router.post("/attendance/break-end",           breakEnd);
router.get ("/attendance/summary/:employeeId", getSummary);
router.get ("/attendance/monthly/:employeeId", getMonthlyRecords);
router.get ("/attendance/daily",               getDailyReport);
router.get ("/attendance/monthly-report",      getMonthlyReport);
router.post("/attendance/hr-mark",             hrMarkAttendance);
router.get ("/attendance/export",              exportExcel);

router.post("/leave-requests",                      createLeaveRequest);
router.get ("/leave-requests/employee/:employeeId", getEmployeeLeaves);
router.get ("/leave-requests",                      getAllLeaves);
router.put ("/leave-requests/:id/approve",          approveLeave);
router.put ("/leave-requests/:id/reject",           rejectLeave);

module.exports = router;