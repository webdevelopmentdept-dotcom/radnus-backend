const express    = require("express");
const router     = express.Router();
const Attendance = require("../models/Attendance");
const Employee   = require("../models/Employee");

const {
  checkIn, checkOut, breakStart, breakEnd,
  getTodayRecord, getSummary, getMonthlyRecords,
  getDailyReport, getMonthlyReport,
  hrMarkAttendance, hrAddPunch, hrDeletePunch,
  exportExcel, migrateOldRecords,
} = require("../controllers/attendanceController");

const {
  createLeaveRequest, getEmployeeLeaves,
  getAllLeaves, approveLeave, rejectLeave,
} = require("../controllers/leaveController");

// ── HR Dashboard today stats ──────────────────────────────────
router.get("/attendance/today", async (req, res) => {
  try {
    const today     = new Date().toISOString().split("T")[0];
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

// ── Employee routes ───────────────────────────────────────────
router.get ("/attendance/today/:employeeId", getTodayRecord);
router.post("/attendance/check-in",          checkIn);
router.post("/attendance/check-out",         checkOut);
router.post("/attendance/break-start",       breakStart);
router.post("/attendance/break-end",         breakEnd);
router.get ("/attendance/summary/:employeeId", getSummary);
router.get ("/attendance/monthly/:employeeId", getMonthlyRecords);

// ── HR routes ─────────────────────────────────────────────────
router.get ("/attendance/daily",          getDailyReport);
router.get ("/attendance/monthly-report", getMonthlyReport);
router.post("/attendance/hr-mark",        hrMarkAttendance);
router.get ("/attendance/export",         exportExcel);

// ── NEW: HR punch management ──────────────────────────────────
// Add a single punch to an existing record
router.post("/attendance/hr-punch/add",    hrAddPunch);
// Delete a specific punch by punch _id
router.post("/attendance/hr-punch/delete", hrDeletePunch);

// ── Migration (run once!) ─────────────────────────────────────
// Call POST /api/attendance/migrate to convert old records
// Remove or protect this route after migration is done
router.post("/attendance/migrate", migrateOldRecords);

// ── Leave routes ──────────────────────────────────────────────
router.post("/leave-requests",                      createLeaveRequest);
router.get ("/leave-requests/employee/:employeeId", getEmployeeLeaves);
router.get ("/leave-requests",                      getAllLeaves);
router.put ("/leave-requests/:id/approve",          approveLeave);
router.put ("/leave-requests/:id/reject",           rejectLeave);

module.exports = router;