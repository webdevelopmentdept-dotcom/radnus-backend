const Attendance   = require("../models/Attendance");
const Employee     = require("../models/Employee");
const LeaveRequest = require("../models/LeaveRequest");

// ══════════════════════════════════════════
//  SHIFT CONFIG
// ══════════════════════════════════════════
const SHIFT_START_HOUR   = 9;
const SHIFT_START_MINUTE = 45;   // 9:45 AM
const LATE_GRACE_MINUTES = 15;   // grace → 10:00 AM
const SHIFT_END_HOUR     = 19;   // 7:00 PM
const SHIFT_END_MINUTE   = 0;

const SHIFT_START_TOTAL = SHIFT_START_HOUR * 60 + SHIFT_START_MINUTE; // 585
const LATE_THRESHOLD    = SHIFT_START_TOTAL + LATE_GRACE_MINUTES;      // 600 = 10:00 AM
const SHIFT_END_TOTAL   = SHIFT_END_HOUR   * 60 + SHIFT_END_MINUTE;   // 1140 = 7:00 PM

const todayStr = () => new Date().toISOString().split("T")[0];
const toMins   = (date) => new Date(date).getHours() * 60 + new Date(date).getMinutes();

// ══════════════════════════════════════════
//  CORE HELPERS
// ══════════════════════════════════════════

// Late minutes based on first punch-in
const getLateMinutes = (firstIn) => {
  if (!firstIn) return 0;
  return Math.max(toMins(firstIn) - LATE_THRESHOLD, 0);
};

// Early-out based on last punch-out
const getEarlyOutMinutes = (lastOut) => {
  if (!lastOut) return 0;
  return Math.max(SHIFT_END_TOTAL - toMins(lastOut), 0);
};

// Overtime based on last punch-out
const getOvertimeMinutes = (lastOut) => {
  if (!lastOut) return 0;
  return Math.max(toMins(lastOut) - SHIFT_END_TOTAL, 0);
};

// ══════════════════════════════════════════
//  PUNCH CALCULATION ENGINE
//  Takes punches[], returns computed stats
// ══════════════════════════════════════════
const computeFromPunches = (punches) => {
  // Sort punches by time ascending
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));

  let netWorkMs   = 0;   // total work milliseconds
  let breakMs     = 0;   // total break milliseconds
  let lastInTime  = null;
  let lastOutTime = null;
  let firstIn     = null;
  let lastOut     = null;

  for (const p of sorted) {
    if (p.type === "in") {
      lastInTime = new Date(p.time);
      if (!firstIn) firstIn = lastInTime;

      // If there was a previous out, calculate break
      if (lastOutTime) {
        breakMs += lastInTime - lastOutTime;
        lastOutTime = null;
      }
    } else if (p.type === "out") {
      if (lastInTime) {
        // Calculate work session
        const outTime = new Date(p.time);
        netWorkMs  += outTime - lastInTime;
        lastOutTime = outTime;
        lastOut     = outTime;
        lastInTime  = null;
      }
    }
  }

  // If currently punched in (no final out), don't count ongoing session
  // lastInTime being non-null means employee is currently "in"

  const workHours    = parseFloat((netWorkMs / 3600000).toFixed(2));
  const breakMinutes = Math.round(breakMs / 60000);

  const lateMinutes      = getLateMinutes(firstIn);
  const earlyOutMinutes  = getEarlyOutMinutes(lastOut);
  const overtimeMinutes  = getOvertimeMinutes(lastOut);

  // Determine status
  let status = "absent";
  if (firstIn) {
    const firstInMins = toMins(firstIn);
    if (workHours >= 4 && workHours < 7) {
      status = "half_day";
    } else if (workHours >= 7) {
      status = firstInMins <= LATE_THRESHOLD ? "present" : "late";
    } else if (!lastOut) {
      // Still inside — tentative status
      status = firstInMins <= LATE_THRESHOLD ? "present" : "late";
    } else {
      // Checked out with < 4 hrs
      status = "half_day";
    }
  }

  return {
    first_in:          firstIn,
    last_out:          lastOut,
    work_hours:        workHours,
    break_minutes:     breakMinutes,
    late_minutes:      lateMinutes,
    early_out_minutes: earlyOutMinutes,
    overtime_minutes:  overtimeMinutes,
    status,
    is_currently_in:   lastInTime !== null, // employee is currently punched in
  };
};

// ══════════════════════════════════════════
//  PUNCH IN  (employee)
// ══════════════════════════════════════════
exports.checkIn = async (req, res) => {
  try {
    const { employee_id, location, method = "manual" } = req.body;
    const today = todayStr();

    // Check approved leave
    const onLeave = await LeaveRequest.findOne({
      employee_id,
      status:    "approved",
      from_date: { $lte: today },
      to_date:   { $gte: today },
    });
    if (onLeave) {
      return res.status(400).json({ success: false, message: "You are on approved leave today" });
    }

    // Get or create today's record
    let record = await Attendance.findOne({ employee_id, date: today });
    if (!record) {
      record = new Attendance({
        employee_id,
        date:   today,
        shift:  "General (9:45 AM – 7:00 PM)",
        punches: [],
      });
    }

    // Check: last punch must not be "in" (can't punch-in twice without punch-out)
    const sortedPunches = [...record.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
    const lastPunch = sortedPunches[sortedPunches.length - 1];
    if (lastPunch && lastPunch.type === "in") {
      return res.status(400).json({
        success: false,
        message: "Already punched in. Please punch out before punching in again.",
      });
    }

    // Add punch-in
    const now = new Date();
    record.punches.push({ type: "in", time: now, method, location: location || {} });

    // Recompute stats
    const computed = computeFromPunches(record.punches);
    Object.assign(record, computed);

    await record.save();

    const punchCount = record.punches.filter(p => p.type === "in").length;
    const isReturn   = punchCount > 1;

    res.json({
      success: true,
      message: isReturn ? "Welcome back! Punched in again." : "Checked in successfully",
      data: record,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  PUNCH OUT  (employee)
// ══════════════════════════════════════════
exports.checkOut = async (req, res) => {
  try {
    const { employee_id, location } = req.body;
    const today = todayStr();

    const record = await Attendance.findOne({ employee_id, date: today });
    if (!record || record.punches.length === 0) {
      return res.status(400).json({ success: false, message: "You haven't punched in today" });
    }

    // Last punch must be "in"
    const sortedPunches = [...record.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
    const lastPunch = sortedPunches[sortedPunches.length - 1];
    if (!lastPunch || lastPunch.type !== "in") {
      return res.status(400).json({
        success: false,
        message: "Already punched out. Punch in first to punch out again.",
      });
    }

    // Add punch-out
    const now = new Date();
    record.punches.push({
      type: "out",
      time: now,
      method: "manual",
      location: location || {},
    });

    // Recompute
    const computed = computeFromPunches(record.punches);
    Object.assign(record, computed);

    await record.save();

    const outCount = record.punches.filter(p => p.type === "out").length;
    res.json({
      success: true,
      message: outCount > 1 ? "Punched out. Come back soon!" : "Checked out successfully",
      data: record,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  BREAK START / END  (legacy — kept for
//  compatibility; internally just punch out/in)
// ══════════════════════════════════════════
exports.breakStart = async (req, res) => {
  // breakStart = punch out (leaving desk)
  req.body.location = req.body.location || {};
  return exports.checkOut(req, res);
};

exports.breakEnd = async (req, res) => {
  // breakEnd = punch in (back at desk)
  req.body.method   = req.body.method || "manual";
  req.body.location = req.body.location || {};
  return exports.checkIn(req, res);
};

// ══════════════════════════════════════════
//  TODAY RECORD  (employee)
// ══════════════════════════════════════════
exports.getTodayRecord = async (req, res) => {
  try {
    const record = await Attendance.findOne({
      employee_id: req.params.employeeId,
      date: todayStr(),
    });
    res.json({ success: true, data: record || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  SUMMARY  (employee monthly)
// ══════════════════════════════════════════
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

// ══════════════════════════════════════════
//  MONTHLY RECORDS  (employee)
// ══════════════════════════════════════════
exports.getMonthlyRecords = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { year, month } = req.query;
    const y = year  || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const records = await Attendance.find({
      employee_id: employeeId,
      date: {
        $gte: `${y}-${String(m).padStart(2, "0")}-01`,
        $lte: `${y}-${String(m).padStart(2, "0")}-31`,
      },
    }).sort({ date: 1 });

    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  DAILY REPORT  (HR)
// ══════════════════════════════════════════
exports.getDailyReport = async (req, res) => {
  try {
    const date = req.query.date || todayStr();

    const [records, employees] = await Promise.all([
      Attendance.find({ date }).populate("employee_id", "name employeeId employee_code department designation"),
      Employee.find({ status: "active" }, "name employeeId employee_code department designation"),
    ]);

    const recordMap = {};
    records.forEach(r => {
      const key = r.employee_id?._id?.toString() || r.employee_id?.toString();
      recordMap[key] = r;
    });

    const result = employees.map(emp => {
      const rec = recordMap[emp._id.toString()];
      if (rec) {
        const obj = rec.toObject();

        // Always recompute from punches for accuracy
        if (obj.punches && obj.punches.length > 0) {
          const computed = computeFromPunches(obj.punches);
          Object.assign(obj, computed);
        }

        obj.employee      = emp;
        obj.missing_punch = obj.is_currently_in && (() => {
          if (date !== todayStr()) return true;
          return new Date().getHours() >= 20;
        })();

        // Backwards-compat: expose checkIn / checkOut from computed
        obj.checkIn  = obj.first_in  || obj.checkIn  || null;
        obj.checkOut = obj.last_out  || obj.checkOut  || null;

        return obj;
      }

      return {
        employee_id:       emp._id,
        employee:          emp,
        date,
        status:            "absent",
        punches:           [],
        checkIn:           null,
        checkOut:          null,
        first_in:          null,
        last_out:          null,
        work_hours:        0,
        late_minutes:      0,
        early_out_minutes: 0,
        overtime_minutes:  0,
        missing_punch:     false,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  MONTHLY REPORT  (HR)
// ══════════════════════════════════════════
exports.getMonthlyReport = async (req, res) => {
  try {
    const { year, month } = req.query;
    const y = year  || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const [employees, records] = await Promise.all([
      Employee.find({ status: "active" }, "name employeeId employee_code department"),
      Attendance.find({
        date: {
          $gte: `${y}-${String(m).padStart(2, "0")}-01`,
          $lte: `${y}-${String(m).padStart(2, "0")}-31`,
        },
      }),
    ]);

    const daysInMonth = new Date(y, m, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() !== 0) workingDays++;
    }

    const todayS = todayStr();

    const result = employees.map(emp => {
      const empRecs = records.filter(r => r.employee_id.toString() === emp._id.toString());

      // Recompute each record from punches
      const enriched = empRecs.map(r => {
        const obj = r.toObject ? r.toObject() : { ...r };
        if (obj.punches && obj.punches.length > 0) {
          const c = computeFromPunches(obj.punches);
          return { ...obj, ...c };
        }
        return obj;
      });

      const present  = enriched.filter(r => r.status === "present").length;
      const late     = enriched.filter(r => r.status === "late").length;
      const half_day = enriched.filter(r => r.status === "half_day").length;
      const on_leave = enriched.filter(r => r.status === "leave").length;
      const absent   = Math.max(workingDays - present - late - half_day - on_leave, 0);

      const totalHrs    = enriched.reduce((s, r) => s + (r.work_hours || 0), 0);
      const avgHoursNum = enriched.length ? parseFloat((totalHrs / enriched.length).toFixed(1)) : 0;
      const avgHours    = enriched.length ? avgHoursNum + "h" : "—";

      const totalLateMins = enriched.reduce((s, r) => s + (r.late_minutes || 0), 0);
      const overtimeDays  = enriched.filter(r => (r.overtime_minutes || 0) > 0).length;
      const earlyOutDays  = enriched.filter(r => (r.early_out_minutes || 0) > 0).length;
      const missingPunch  = enriched.filter(r => r.is_currently_in && r.date !== todayS).length;

      const pct = workingDays
        ? Math.round(((present + late + half_day * 0.5) / workingDays) * 100)
        : 0;

      return {
        _id:                emp._id,
        name:               emp.name,
        employeeId:         emp.employeeId,
        employee_code:      emp.employee_code,
        department:         emp.department,
        present,
        late,
        half_day,
        on_leave,
        absent,
        overtime_days:      overtimeDays,
        early_out_days:     earlyOutDays,
        missing_punch_days: missingPunch,
        total_late_minutes: totalLateMins,
        work_days:          workingDays,
        avg_work_hours:     avgHours,
        avg_work_hours_num: avgHoursNum,
        attendance_pct:     pct,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  HR MARK ATTENDANCE  (manual override)
//
//  HR can:
//  1. Add/edit individual punches
//  2. Or set a simple checkIn + checkOut
//     (system converts to 2 punches)
// ══════════════════════════════════════════
exports.hrMarkAttendance = async (req, res) => {
  try {
    const { employee_id, date, status, checkIn, checkOut, punches, shift, remark } = req.body;

    let newPunches = [];

    if (punches && Array.isArray(punches) && punches.length > 0) {
      // HR provided explicit punch array
      newPunches = punches.map(p => ({
        type:   p.type,
        time:   new Date(p.time),
        method: "hr_manual",
        remark: p.remark || "",
      }));
    } else if (checkIn) {
      // Legacy: convert checkIn/checkOut to punches
      newPunches.push({ type: "in",  time: new Date(checkIn),  method: "hr_manual" });
      if (checkOut) {
        newPunches.push({ type: "out", time: new Date(checkOut), method: "hr_manual" });
      }
    }

    // Compute from punches
    const computed = newPunches.length > 0
      ? computeFromPunches(newPunches)
      : { work_hours: 0, late_minutes: 0, early_out_minutes: 0, overtime_minutes: 0 };

    // If HR explicitly passed status (leave, holiday, etc.) respect it
    const finalStatus = status && ["leave", "holiday", "weekend", "absent"].includes(status)
      ? status
      : computed.status;

    const record = await Attendance.findOneAndUpdate(
      { employee_id, date },
      {
        $set: {
          employee_id,
          date,
          punches:           newPunches,
          status:            finalStatus,
          first_in:          computed.first_in  || null,
          last_out:          computed.last_out   || null,
          work_hours:        computed.work_hours,
          break_minutes:     computed.break_minutes || 0,
          late_minutes:      computed.late_minutes,
          early_out_minutes: computed.early_out_minutes,
          overtime_minutes:  computed.overtime_minutes,
          shift:             shift  || "General (9:45 AM – 7:00 PM)",
          remark:            remark || "",
          method:            "hr_manual",
        },
      },
      { upsert: true, new: true }
    );

    res.json({ success: true, message: "Attendance marked", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  ADD SINGLE PUNCH  (HR — add one punch
//  without replacing everything)
// ══════════════════════════════════════════
exports.hrAddPunch = async (req, res) => {
  try {
    const { employee_id, date, type, time, remark } = req.body;

    if (!["in", "out"].includes(type)) {
      return res.status(400).json({ success: false, message: "type must be 'in' or 'out'" });
    }

    let record = await Attendance.findOne({ employee_id, date });
    if (!record) {
      record = new Attendance({ employee_id, date, punches: [] });
    }

    record.punches.push({
      type,
      time:   new Date(time),
      method: "hr_manual",
      remark: remark || "",
    });

    const computed = computeFromPunches(record.punches);
    Object.assign(record, computed);

    await record.save();
    res.json({ success: true, message: `Punch ${type} added`, data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  DELETE SINGLE PUNCH  (HR)
// ══════════════════════════════════════════
exports.hrDeletePunch = async (req, res) => {
  try {
    const { employee_id, date, punch_id } = req.body;

    const record = await Attendance.findOne({ employee_id, date });
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    record.punches = record.punches.filter(p => p._id.toString() !== punch_id);

    const computed = computeFromPunches(record.punches);
    Object.assign(record, computed);

    await record.save();
    res.json({ success: true, message: "Punch deleted", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  EXPORT EXCEL  (HR)
// ══════════════════════════════════════════
exports.exportExcel = async (req, res) => {
  try {
    const ExcelJS = require("exceljs");
    const { year, month } = req.query;
    const y = year  || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const [employees, records] = await Promise.all([
      Employee.find({ status: "active" }, "name employeeId employee_code department"),
      Attendance.find({
        date: {
          $gte: `${y}-${String(m).padStart(2, "0")}-01`,
          $lte: `${y}-${String(m).padStart(2, "0")}-31`,
        },
      }),
    ]);

    const workbook  = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Attendance");

    worksheet.columns = [
      { header: "Employee",         key: "name",               width: 22 },
      { header: "Emp Code",         key: "employee_code",      width: 14 },
      { header: "Department",       key: "department",         width: 18 },
      { header: "Work Days",        key: "work_days",          width: 11 },
      { header: "Present",          key: "present",            width: 10 },
      { header: "Late",             key: "late",               width: 10 },
      { header: "Total Late (min)", key: "total_late_minutes", width: 16 },
      { header: "Half Day",         key: "half_day",           width: 10 },
      { header: "On Leave",         key: "on_leave",           width: 10 },
      { header: "Absent",           key: "absent",             width: 10 },
      { header: "Overtime Days",    key: "overtime_days",      width: 14 },
      { header: "Early Out Days",   key: "early_out_days",     width: 14 },
      { header: "Missing Punch",    key: "missing_punch_days", width: 14 },
      { header: "Avg Work Hours",   key: "avg_work_hours",     width: 16 },
      { header: "Attendance %",     key: "attendance_pct",     width: 14 },
    ];

    worksheet.getRow(1).eachCell(cell => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
      cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
      cell.alignment = { vertical: "middle", horizontal: "center" };
    });
    worksheet.getRow(1).height = 28;

    const daysInMonth = new Date(y, m, 0).getDate();
    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      if (new Date(y, m - 1, d).getDay() !== 0) workingDays++;
    }

    const todayS = todayStr();

    employees.forEach(emp => {
      const empRecs = records.filter(r => r.employee_id.toString() === emp._id.toString());

      const enriched = empRecs.map(r => {
        const obj = r.toObject ? r.toObject() : { ...r };
        if (obj.punches && obj.punches.length > 0) {
          return { ...obj, ...computeFromPunches(obj.punches) };
        }
        return obj;
      });

      const present  = enriched.filter(r => r.status === "present").length;
      const late     = enriched.filter(r => r.status === "late").length;
      const half_day = enriched.filter(r => r.status === "half_day").length;
      const on_leave = enriched.filter(r => r.status === "leave").length;
      const absent   = Math.max(workingDays - present - late - half_day - on_leave, 0);
      const totalHrs = enriched.reduce((s, r) => s + (r.work_hours || 0), 0);
      const avgHours = enriched.length ? (totalHrs / enriched.length).toFixed(1) + "h" : "—";
      const totalLateMins = enriched.reduce((s, r) => s + (r.late_minutes || 0), 0);
      const overtimeDays  = enriched.filter(r => (r.overtime_minutes || 0) > 0).length;
      const earlyOutDays  = enriched.filter(r => (r.early_out_minutes || 0) > 0).length;
      const missingPunch  = enriched.filter(r => r.is_currently_in && r.date !== todayS).length;
      const pct           = workingDays ? Math.round(((present + late + half_day * 0.5) / workingDays) * 100) : 0;

      const row = worksheet.addRow({
        name:               emp.name,
        employee_code:      emp.employeeId || emp.employee_code,
        department:         emp.department,
        work_days:          workingDays,
        present, late,
        total_late_minutes: totalLateMins,
        half_day, on_leave, absent,
        overtime_days:      overtimeDays,
        early_out_days:     earlyOutDays,
        missing_punch_days: missingPunch,
        avg_work_hours:     avgHours,
        attendance_pct:     pct + "%",
      });

      row.getCell("attendance_pct").fill = {
        type: "pattern", pattern: "solid",
        fgColor: { argb: pct >= 90 ? "FFdcfce7" : pct >= 75 ? "FFfef9c3" : "FFfee2e2" },
      };
      if (missingPunch > 0) {
        row.getCell("missing_punch_days").fill = {
          type: "pattern", pattern: "solid", fgColor: { argb: "FFfee2e2" },
        };
        row.getCell("missing_punch_days").font = { color: { argb: "FFb91c1c" }, bold: true };
      }
    });

    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to:   { row: 1, column: worksheet.columns.length },
    };

    const monthName = new Date(y, m - 1).toLocaleString("en-IN", { month: "long" });
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename=Attendance_${monthName}_${y}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  MIGRATION HELPER
//  Run once to convert old checkIn/checkOut
//  records to punches[] format
// ══════════════════════════════════════════
exports.migrateOldRecords = async (req, res) => {
  try {
    // Find records that have checkIn but empty punches
    const old = await Attendance.find({
      checkIn:  { $exists: true, $ne: null },
      $or: [{ punches: { $exists: false } }, { punches: { $size: 0 } }],
    });

    let migrated = 0;

    for (const rec of old) {
      const newPunches = [];
      if (rec.checkIn)  newPunches.push({ type: "in",  time: rec.checkIn,  method: rec.method || "manual" });
      if (rec.checkOut) newPunches.push({ type: "out", time: rec.checkOut, method: rec.method || "manual" });

      if (newPunches.length > 0) {
        const computed = computeFromPunches(newPunches);
        rec.punches = newPunches;
        Object.assign(rec, computed);
        await rec.save();
        migrated++;
      }
    }

    res.json({ success: true, message: `Migrated ${migrated} records`, total: old.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};