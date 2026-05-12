const Attendance   = require("../models/Attendance");
const Employee     = require("../models/Employee");
const LeaveRequest = require("../models/LeaveRequest");

// ── Shift Config ──────────────────────────────────────────────
const SHIFT_START_HOUR   = 9;
const SHIFT_START_MINUTE = 45;  // 9:45 AM
const LATE_GRACE_MINUTES = 15;  // 10:00 AM vara grace
const SHIFT_END_HOUR     = 19;  // 7:00 PM
const LUNCH_START_HOUR   = 13;
const LUNCH_START_MINUTE = 30;
const LUNCH_END_HOUR     = 14;
const LUNCH_END_MINUTE   = 30;
const LUNCH_MINUTES      = 60;

const todayStr = () => new Date().toISOString().split("T")[0];

// ── Status from checkIn time ──────────────────────────────────
const getStatusFromTime = (checkInDate) => {
  const totalMins = checkInDate.getHours() * 60 + checkInDate.getMinutes();
  const shiftMins = SHIFT_START_HOUR * 60 + SHIFT_START_MINUTE;
  const lateMins  = shiftMins + LATE_GRACE_MINUTES;
  return totalMins <= lateMins ? "present" : "late";
};

// ── POST /api/attendance/check-in ─────────────────────────────
exports.checkIn = async (req, res) => {
  try {
    const { employee_id, location, method = "manual" } = req.body;
    const today = todayStr();

    const existing = await Attendance.findOne({ employee_id, date: today });
    if (existing?.checkIn) {
      return res.status(400).json({ success: false, message: "Already checked in today" });
    }

    const onLeave = await LeaveRequest.findOne({
      employee_id,
      status:    "approved",
      from_date: { $lte: today },
      to_date:   { $gte: today },
    });
    if (onLeave) {
      return res.status(400).json({ success: false, message: "You are on approved leave today" });
    }

    const now    = new Date();
    const status = getStatusFromTime(now);

    const record = await Attendance.findOneAndUpdate(
      { employee_id, date: today },
      {
        $set: {
          employee_id,
          date:    today,
          checkIn: now,
          status,
          method,
          shift:    "General (9:45 AM – 7:00 PM)",
          location: location || {},
        },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Checked in successfully", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/attendance/break-start ─────────────────────────
exports.breakStart = async (req, res) => {
  try {
    const { employee_id } = req.body;
    const today = todayStr();

    const record = await Attendance.findOne({ employee_id, date: today });
    if (!record?.checkIn) {
      return res.status(400).json({ success: false, message: "Please check in first" });
    }
    if (record.checkOut) {
      return res.status(400).json({ success: false, message: "Already checked out" });
    }
    if (record.breakStart && !record.breakEnd) {
      return res.status(400).json({ success: false, message: "Already on break" });
    }
    if (record.breakEnd) {
      return res.status(400).json({ success: false, message: "Break already completed for today" });
    }

    record.breakStart = new Date();
    await record.save();

    res.json({ success: true, message: "Lunch break started", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/attendance/break-end ───────────────────────────
exports.breakEnd = async (req, res) => {
  try {
    const { employee_id } = req.body;
    const today = todayStr();

    const record = await Attendance.findOne({ employee_id, date: today });
    if (!record?.breakStart) {
      return res.status(400).json({ success: false, message: "Break not started" });
    }
    if (record.breakEnd) {
      return res.status(400).json({ success: false, message: "Break already ended" });
    }

    record.breakEnd      = new Date();
    record.break_minutes = Math.round(
      (record.breakEnd - record.breakStart) / 60000
    );
    await record.save();

    res.json({ success: true, message: "Break ended, welcome back!", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/attendance/check-out ───────────────────────────
exports.checkOut = async (req, res) => {
  try {
    const { employee_id, location } = req.body;
    const today = todayStr();

    const record = await Attendance.findOne({ employee_id, date: today });
    if (!record?.checkIn) {
      return res.status(400).json({ success: false, message: "You haven't checked in today" });
    }
    if (record.checkOut) {
      return res.status(400).json({ success: false, message: "Already checked out today" });
    }

    const now     = new Date();
    const totalMs = now - new Date(record.checkIn);
    const breakMs    = (record.break_minutes || LUNCH_MINUTES) * 60000;
    const work_hours = parseFloat(((totalMs - breakMs) / 3600000).toFixed(2));

    let status = record.status;
    if (work_hours < 4) status = "half_day";

    record.checkOut   = now;
    record.work_hours = Math.max(work_hours, 0);
    record.status     = status;
    if (location) record.location = location;

    if (record.breakStart && !record.breakEnd) {
      record.breakEnd      = now;
      record.break_minutes = LUNCH_MINUTES;
    }

    await record.save();

    res.json({ success: true, message: "Checked out successfully", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/attendance/today/:employeeId ─────────────────────
exports.getTodayRecord = async (req, res) => {
  try {
    const record = await Attendance.findOne({
      employee_id: req.params.employeeId,
      date:        todayStr(),
    });
    res.json({ success: true, data: record || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/attendance/summary/:employeeId ───────────────────
exports.getSummary = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const y = new Date().getFullYear();
    const m = String(new Date().getMonth() + 1).padStart(2, "0");

    const records = await Attendance.find({
      employee_id: employeeId,
      date: { $gte: `${y}-${m}-01`, $lte: `${y}-${m}-31` },
    });

    res.json({
      success: true,
      data: {
        present:   records.filter(r => r.status === "present").length,
        absent:    records.filter(r => r.status === "absent").length,
        late:      records.filter(r => r.status === "late").length,
        onLeave:   records.filter(r => r.status === "leave").length,
        halfDay:   records.filter(r => r.status === "half_day").length,
        totalDays: records.length,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/attendance/monthly/:employeeId ───────────────────
exports.getMonthlyRecords = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { year, month } = req.query;
    const y = year  || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const records = await Attendance.find({
      employee_id: employeeId,
      date: {
        $gte: `${y}-${String(m).padStart(2,"0")}-01`,
        $lte: `${y}-${String(m).padStart(2,"0")}-31`,
      },
    }).sort({ date: 1 });

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/attendance/daily ─────────────────────────────────
exports.getDailyReport = async (req, res) => {
  try {
    const date = req.query.date || todayStr();
    const [records, employees] = await Promise.all([
      Attendance.find({ date }).populate("employee_id", "name employeeId employee_code department designation"),
      Employee.find({ status: "active" }, "name employeeId employee_code department designation"),
    ]);

    const recordMap = {};
    records.forEach(r => {
      recordMap[r.employee_id?._id?.toString() || r.employee_id?.toString()] = r;
    });

    const result = employees.map(emp => {
      const rec = recordMap[emp._id.toString()];
      return rec
        ? { ...rec.toObject(), employee: emp }
        : { employee_id: emp._id, employee: emp, date, status: "absent", checkIn: null, checkOut: null };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/attendance/monthly-report ───────────────────────
exports.getMonthlyReport = async (req, res) => {
  try {
    const { year, month } = req.query;
    const y = year  || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const [employees, records] = await Promise.all([
      Employee.find({ status: "active" }, "name employeeId employee_code department"),
      Attendance.find({
        date: {
          $gte: `${y}-${String(m).padStart(2,"0")}-01`,
          $lte: `${y}-${String(m).padStart(2,"0")}-31`,
        },
      }),
    ]);

    const daysInMonth = new Date(y, m, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() !== 0) workingDays++;
    }

    const result = employees.map(emp => {
      const empRecs  = records.filter(r => r.employee_id.toString() === emp._id.toString());
      const present  = empRecs.filter(r => r.status === "present").length;
      const late     = empRecs.filter(r => r.status === "late").length;
      const half_day = empRecs.filter(r => r.status === "half_day").length;
      const on_leave = empRecs.filter(r => r.status === "leave").length;
      const absent   = Math.max(workingDays - present - late - half_day - on_leave, 0);
      const totalHrs = empRecs.reduce((s, r) => s + (r.work_hours || 0), 0);
      const avgHours = empRecs.length ? (totalHrs / empRecs.length).toFixed(1) + "h" : "—";
      const pct      = workingDays
        ? Math.round(((present + late + half_day * 0.5) / workingDays) * 100)
        : 0;

      return {
        _id:           emp._id,
        name:          emp.name,
        employeeId:    emp.employeeId,        // ✅ FIXED
        employee_code: emp.employee_code,
        department:    emp.department,
        present, late, half_day, on_leave, absent,
        work_days: workingDays, avg_work_hours: avgHours, attendance_pct: pct,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/attendance/hr-mark ──────────────────────────────
exports.hrMarkAttendance = async (req, res) => {
  try {
    const { employee_id, date, status, checkIn, checkOut, shift, remark } = req.body;
    const checkInDate  = checkIn  ? new Date(checkIn)  : null;
    const checkOutDate = checkOut ? new Date(checkOut) : null;
    let work_hours = 0;
    if (checkInDate && checkOutDate) {
      const totalMs = checkOutDate - checkInDate;
      work_hours    = parseFloat(((totalMs - LUNCH_MINUTES * 60000) / 3600000).toFixed(2));
    }

    const record = await Attendance.findOneAndUpdate(
      { employee_id, date },
      {
        $set: {
          employee_id, date, status,
          checkIn:    checkInDate,
          checkOut:   checkOutDate,
          work_hours: Math.max(work_hours, 0),
          shift:      shift || "General (9:45 AM – 7:00 PM)",
          remark:     remark || "",
          method:     "hr_manual",
        }
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Attendance marked", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/attendance/export ────────────────────────────────
exports.exportExcel = async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const { year, month } = req.query;
    const y = year  || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const [employees, records] = await Promise.all([
      Employee.find({ status: "active" }, "name employeeId employee_code department"), // ✅ FIXED
      Attendance.find({
        date: {
          $gte: `${y}-${String(m).padStart(2,"0")}-01`,
          $lte: `${y}-${String(m).padStart(2,"0")}-31`,
        },
      }),
    ]);

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Attendance");

    worksheet.columns = [
      { header: "Employee",       key: "name",           width: 22 },
      { header: "Emp Code",       key: "employee_code",  width: 14 },
      { header: "Department",     key: "department",     width: 18 },
      { header: "Present",        key: "present",        width: 10 },
      { header: "Absent",         key: "absent",         width: 10 },
      { header: "Late",           key: "late",           width: 10 },
      { header: "Half Day",       key: "half_day",       width: 10 },
      { header: "On Leave",       key: "on_leave",       width: 10 },
      { header: "Avg Work Hours", key: "avg_work_hours", width: 16 },
      { header: "Attendance %",   key: "attendance_pct", width: 14 },
    ];

    worksheet.getRow(1).eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    });

    const daysInMonth = new Date(y, m, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() !== 0) workingDays++;
    }

    employees.forEach(emp => {
      const empRecs  = records.filter(r => r.employee_id.toString() === emp._id.toString());
      const present  = empRecs.filter(r => r.status === "present").length;
      const late     = empRecs.filter(r => r.status === "late").length;
      const half_day = empRecs.filter(r => r.status === "half_day").length;
      const on_leave = empRecs.filter(r => r.status === "leave").length;
      const absent   = Math.max(workingDays - present - late - half_day - on_leave, 0);
      const totalHrs = empRecs.reduce((s, r) => s + (r.work_hours || 0), 0);
      const avgHours = empRecs.length ? (totalHrs / empRecs.length).toFixed(1) + "h" : "—";
      const pct      = workingDays ? Math.round(((present + late + half_day * 0.5) / workingDays) * 100) : 0;

      const row = worksheet.addRow({
        name:          emp.name,
        employee_code: emp.employeeId || emp.employee_code, // ✅ FIXED
        department:    emp.department,
        present, absent, late, half_day, on_leave,
        avg_work_hours: avgHours, attendance_pct: pct + "%",
      });

      row.getCell("attendance_pct").fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: pct >= 90 ? "FFdcfce7" : pct >= 75 ? "FFfef9c3" : "FFfee2e2" },
      };
    });

    const monthName = new Date(y, m - 1).toLocaleString("en-IN", { month: "long" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Attendance_${monthName}_${y}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};