const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const LeaveRequest = require("../models/LeaveRequest");

// ══════════════════════════════════════════
//  SHIFT CONFIG
// ══════════════════════════════════════════
const SHIFT_START_HOUR = 10;
const SHIFT_START_MINUTE = 0;    // 10:00 AM
const LATE_GRACE_MINUTES = 0;    // No separate grace - logic handles it
const SHIFT_END_HOUR = 19;
const SHIFT_END_MINUTE = 0;

const SHIFT_START_TOTAL = SHIFT_START_HOUR * 60 + SHIFT_START_MINUTE; // 600 = 10:00 AM
const LATE_THRESHOLD = SHIFT_START_TOTAL;                           // 600 = 10:00 AM
const SHIFT_END_TOTAL = SHIFT_END_HOUR * 60 + SHIFT_END_MINUTE;     // 1140 = 7:00 PM

// Timing boundaries (minutes)
const MORNING_CUTOFF = 11 * 60 + 30;  // 11:30 AM - present window ends
const LUNCH_START = 13 * 60 + 30;  // 1:30 PM  - lunch window start
const LUNCH_END = 14 * 60 + 30;  // 2:30 PM  - lunch window end
const LATE_GRACE_END = 14 * 60 + 50;  // 2:50 PM  - grace period end

const todayStr = () => new Date().toISOString().split("T")[0];
const parseShiftStart = (shiftStr) => {
  if (!shiftStr) return SHIFT_START_TOTAL;
  const match = shiftStr.match(/(\d{1,2}):(\d{2})\s*[–\-]/);
  if (match) return parseInt(match[1]) * 60 + parseInt(match[2]);
  return SHIFT_START_TOTAL;
};

const parseShiftEnd = (shiftStr) => {
  if (!shiftStr) return SHIFT_END_TOTAL;
  const matches = [...shiftStr.matchAll(/(\d{1,2}):(\d{2})/g)];
  if (matches.length >= 2) return parseInt(matches[1][1]) * 60 + parseInt(matches[1][2]);
  return SHIFT_END_TOTAL;
};
const toMins = (date) => new Date(date).getHours() * 60 + new Date(date).getMinutes();

// ══════════════════════════════════════════
//  CORE HELPERS
// ══════════════════════════════════════════
const getLateMinutes = (firstIn, shiftStr = "") => {
  if (!firstIn) return 0;
  const shiftStart = parseShiftStart(shiftStr);
  return Math.max(toMins(firstIn) - shiftStart, 0);
};

const getEarlyOutMinutes = (lastOut) => {
  if (!lastOut) return 0;
  return Math.max(SHIFT_END_TOTAL - toMins(lastOut), 0);
};

const getOvertimeMinutes = (lastOut) => {
  if (!lastOut) return 0;
  return Math.max(toMins(lastOut) - SHIFT_END_TOTAL, 0);
};

// ══════════════════════════════════════════
//  PUNCH CALCULATION ENGINE
// ══════════════════════════════════════════
const computeFromPunches = (punches, shiftStr = "") => {
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));

  let netWorkMs = 0;
  let breakMs = 0;
  let lastInTime = null;
  let lastOutTime = null;
  let firstIn = null;
  let lastOut = null;

  for (const p of sorted) {
    if (p.type === "in") {
      lastInTime = new Date(p.time);
      if (!firstIn) firstIn = lastInTime;
      if (lastOutTime) {
        breakMs += lastInTime - lastOutTime;
        lastOutTime = null;
      }
    } else if (p.type === "out") {
      if (lastInTime) {
        const outTime = new Date(p.time);
        netWorkMs += outTime - lastInTime;
        lastOutTime = outTime;
        lastOut = outTime;
        lastInTime = null;
      }
    }
  }

  const workHours = parseFloat((netWorkMs / 3600000).toFixed(2));
  const breakMinutes = Math.round(breakMs / 60000);

  const lateMinutes = getLateMinutes(firstIn, shiftStr);
  const earlyOutMinutes = getEarlyOutMinutes(lastOut);
  const overtimeMinutes = getOvertimeMinutes(lastOut);

  let status = "absent";
  if (firstIn) {
    const firstInMins = toMins(firstIn);
    const shiftStart = parseShiftStart(shiftStr);
    const halfDayCutoff = shiftStart + 90; // 11:30 AM

    if (firstInMins <= shiftStart) {
      status = "present";
    } else if (firstInMins <= halfDayCutoff) {
      status = "late";
    } else if (firstInMins >= LUNCH_START && firstInMins <= LUNCH_END) {
      status = "present"; // Break time punch in → present
    } else if (firstInMins > LUNCH_END) {
      status = "late";    // After 2:30 PM → late
    } else {
      status = "half_day";
    }
  }
  const hasAnyIn = sorted.some(p => p.type === "in");
  if (!hasAnyIn && sorted.some(p => p.type === "out")) {
    status = "absent";
  }

  return {
    first_in: firstIn,
    last_out: lastOut,
    work_hours: workHours,
    break_minutes: breakMinutes,
    late_minutes: lateMinutes,
    early_out_minutes: earlyOutMinutes,
    overtime_minutes: overtimeMinutes,
    status,
    is_currently_in: lastInTime !== null,
  };
};

// ══════════════════════════════════════════
//  PUNCH IN  (employee)
// ══════════════════════════════════════════
exports.checkIn = async (req, res) => {
  try {
    const { employee_id, location, method = "manual" } = req.body;
    const today = todayStr();

    const onLeave = await LeaveRequest.findOne({
      employee_id,
      status: "approved",
      from_date: { $lte: today },
      to_date: { $gte: today },
    });
    if (onLeave) {
      return res.status(400).json({ success: false, message: "You are on approved leave today" });
    }

    let record = await Attendance.findOne({ employee_id, date: today });
    if (!record) {
      const empData = await Employee.findById(employee_id).select("shift").lean();
const empShiftName = empData?.shift || "General";

const Shift = require("../models/Shift");
const shiftDoc = await Shift.findOne({ name: empShiftName }).lean();
const shiftStr = shiftDoc
  ? `${shiftDoc.name} (${shiftDoc.startTime} – ${shiftDoc.endTime})`
  : "General (10:00 – 19:00)";

record = new Attendance({
  employee_id,
  date: today,
  shift: shiftStr,
  punches: [],
});
    }

    // ✅ HYBRID FIX: if auto-marked with no punches, allow check-in normally
    if (record.punches.length > 0) {
      const sortedPunches = [...record.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
      const lastPunch = sortedPunches[sortedPunches.length - 1];
      if (lastPunch && lastPunch.type === "in") {
        return res.status(400).json({
          success: false,
          message: "Already punched in. Please punch out before punching in again.",
        });
      }
    }

    const now = new Date();

    // ✅ Duplicate punch prevention (60 sec window)
    const recentDup = record.punches.find(p =>
      p.type === "in" && Math.abs(new Date(p.time) - now) < 60000
    );
    if (recentDup) {
      return res.json({ success: true, message: "Duplicate punch ignored", data: record });
    }

    record.punches.push({ type: "in", time: now, method, location: location || {} });

    const computed = computeFromPunches(record.punches, record.shift);
    Object.assign(record, computed);

    await record.save();

    const punchCount = record.punches.filter(p => p.type === "in").length;
    const isReturn = punchCount > 1;

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

    if (!record) {
      return res.status(400).json({
        success: false,
        message: "No attendance record for today. Please check in first.",
      });
    }

    // ✅ HYBRID FIX: Auto-marked employee (status present/late, punches empty)
    const isAutoMarked = ["present", "late"].includes(record.status) && record.punches.length === 0;

    if (isAutoMarked) {
      const now = new Date();
      record.punches.push({
        type: "out",
        time: now,
        method: "manual",
        location: location || {},
        remark: "checkout after auto check-in",
      });

      const computed = computeFromPunches(record.punches, record.shift);

      record.last_out = now;
      record.checkOut = now;
      record.early_out_minutes = computed.early_out_minutes;
      record.overtime_minutes = computed.overtime_minutes;

      await record.save();

      return res.json({
        success: true,
        message: "Checked out successfully",
        data: record,
      });
    }

    if (record.punches.length === 0) {
      return res.status(400).json({
        success: false,
        message: "You haven't punched in today.",
      });
    }

    const sortedPunches = [...record.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
    const lastPunch = sortedPunches[sortedPunches.length - 1];

    if (!lastPunch || lastPunch.type !== "in") {
      return res.status(400).json({
        success: false,
        message: "Already punched out. Punch in first to punch out again.",
      });
    }

    const now = new Date();

    // ✅ Duplicate punch prevention (60 sec window)
    const recentOutDup = record.punches.find(p =>
      p.type === "out" && Math.abs(new Date(p.time) - now) < 60000
    );
    if (recentOutDup) {
      return res.json({ success: true, message: "Duplicate punch ignored", data: record });
    }

    record.punches.push({
      type: "out",
      time: now,
      method: "manual",
      location: location || {},
    });

    const computed = computeFromPunches(record.punches, record.shift);
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
//  BREAK START / END  (legacy)
// ══════════════════════════════════════════
exports.breakStart = async (req, res) => {
  req.body.location = req.body.location || {};
  return exports.checkOut(req, res);
};

exports.breakEnd = async (req, res) => {
  req.body.method = req.body.method || "manual";
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

    if (!record) {
      return res.json({ success: true, data: null });
    }

    const obj = record.toObject();

    if (obj.punches && obj.punches.length > 0) {
      const sorted = [...obj.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
      const firstIn = sorted.find(p => p.type === "in");
      const lastOut = [...sorted].reverse().find(p => p.type === "out");

      obj.checkIn = firstIn ? firstIn.time : obj.checkIn || null;
      obj.checkOut = lastOut ? lastOut.time : obj.checkOut || null;

      const outPunches = sorted.filter(p => p.type === "out");
      const inPunches = sorted.filter(p => p.type === "in");

      if (outPunches.length > 1) {
        obj.breakStart = outPunches[0].time;
        obj.breakEnd = inPunches.length > 1 ? inPunches[1].time : null;
      } else if (outPunches.length === 1 && inPunches.length > 1) {
        obj.breakStart = outPunches[0].time;
        obj.breakEnd = inPunches[1].time;
      } else {
        obj.breakStart = null;
        obj.breakEnd = null;
      }
    }

    res.json({ success: true, data: obj });
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
        present: records.filter(r => r.status === "present").length,
        absent: records.filter(r => r.status === "absent").length,
        late: records.filter(r => r.status === "late").length,
        onLeave: records.filter(r => r.status === "leave").length,
        halfDay: records.filter(r => r.status === "half_day").length,
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
    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const records = await Attendance.find({
      employee_id: employeeId,
      date: {
        $gte: `${y}-${String(m).padStart(2, "0")}-01`,
        $lte: `${y}-${String(m).padStart(2, "0")}-31`,
      },
    }).sort({ date: 1 });

    const enriched = records.map(r => {
      const obj = r.toObject();
      if (obj.punches && obj.punches.length > 0) {
        const sorted = [...obj.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
        const firstIn = sorted.find(p => p.type === "in");
        const lastOut = [...sorted].reverse().find(p => p.type === "out");
        obj.checkIn = firstIn ? firstIn.time : obj.checkIn || null;
        obj.checkOut = lastOut ? lastOut.time : obj.checkOut || null;
      }
      return obj;
    });

    res.json({ success: true, data: enriched });
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
      Employee.find({ status: { $in: ["active", "approved"] } }, "name employeeId employee_code department designation"),
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

        if (obj.punches && obj.punches.length > 0) {
          const computed = computeFromPunches(obj.punches, obj.shift);
          Object.assign(obj, computed);
        }

        obj.employee = emp;
        obj.missing_punch = obj.is_currently_in && (() => {
          if (date !== todayStr()) return true;
          return new Date().getHours() >= 20;
        })();

        obj.checkIn = obj.first_in || obj.checkIn || null;
        obj.checkOut = obj.last_out || obj.checkOut || null;

        return obj;
      }

      return {
        employee_id: emp._id,
        employee: emp,
        date,
        status: "absent",
        punches: [],
        checkIn: null,
        checkOut: null,
        first_in: null,
        last_out: null,
        work_hours: 0,
        late_minutes: 0,
        early_out_minutes: 0,
        overtime_minutes: 0,
        missing_punch: false,
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
    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;

    const [employees, records] = await Promise.all([
      Employee.find({ status: { $in: ["active", "approved"] } }, "name employeeId employee_code department"),
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
  const day = new Date(y, m - 1, d).getDay();
if (day !== 0) workingDays++; // Saturday working day
}

    const todayS = todayStr();

    const result = employees.map(emp => {
      const empRecs = records.filter(r => r.employee_id.toString() === emp._id.toString());

      const enriched = empRecs.map(r => {
  const obj = r.toObject ? r.toObject() : { ...r };
  if (obj.punches && obj.punches.length > 0) {
    const c = computeFromPunches(obj.punches, obj.shift || "");
    return { ...obj, ...c };
  }
  return obj;
});



      const present = enriched.filter(r => r.status === "present").length;
      const late = enriched.filter(r => r.status === "late" || (r.late_minutes || 0) > 0).length;
      const half_day = enriched.filter(r => r.status === "half_day").length;
      const on_leave = enriched.filter(r => r.status === "leave").length;
      const absent = Math.max(workingDays - present - half_day - on_leave, 0);

      const totalHrs = enriched.reduce((s, r) => s + (r.work_hours || 0), 0);
      const avgHoursNum = enriched.length ? parseFloat((totalHrs / enriched.length).toFixed(1)) : 0;
      const avgHours = enriched.length ? avgHoursNum + "h" : "—";

      const totalLateMins = enriched.reduce((s, r) => s + (r.late_minutes || 0), 0);
      const overtimeDays = enriched.filter(r => (r.overtime_minutes || 0) > 0).length;
      const earlyOutDays = enriched.filter(r => (r.early_out_minutes || 0) > 0).length;
      const missingPunch = enriched.filter(r => r.is_currently_in && r.date !== todayS).length;

      const pct = workingDays
        ? Math.round(((present + half_day * 0.5) / workingDays) * 100)
        : 0;

      return {
        _id: emp._id,
        name: emp.name,
        employeeId: emp.employeeId,
        employee_code: emp.employee_code,
        department: emp.department,
        present,
        late,
        half_day,
        on_leave,
        absent,
        overtime_days: overtimeDays,
        early_out_days: earlyOutDays,
        missing_punch_days: missingPunch,
        total_late_minutes: totalLateMins,
        work_days: workingDays,
        avg_work_hours: avgHours,
        avg_work_hours_num: avgHoursNum,
        attendance_pct: pct,
      };
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  HR MARK ATTENDANCE
// ══════════════════════════════════════════
exports.hrMarkAttendance = async (req, res) => {
  try {
    const { employee_id, date, status, checkIn, checkOut, punches, shift, remark } = req.body;

    const noTimeStatus = ["leave", "holiday", "weekend", "absent"].includes(status);

    let newPunches = [];

    if (!noTimeStatus) {
      if (punches && Array.isArray(punches) && punches.length > 0) {
        newPunches = punches.map(p => ({
          type: p.type,
          time: new Date(p.time),
          method: "hr_manual",
          remark: p.remark || "",
        }));
      } else if (checkIn) {
        newPunches.push({ type: "in", time: new Date(checkIn), method: "hr_manual" });
        if (checkOut) {
          newPunches.push({ type: "out", time: new Date(checkOut), method: "hr_manual" });
        }
      }
    }

    const computed = newPunches.length > 0
      ? computeFromPunches(newPunches, shift)
      : { work_hours: 0, late_minutes: 0, early_out_minutes: 0, overtime_minutes: 0 };

    const finalStatus = noTimeStatus ? status : (computed.status || status || "present");

    const record = await Attendance.findOneAndUpdate(
      { employee_id, date },
      {
        $set: {
          employee_id,
          date,
          punches: newPunches,
          status: finalStatus,
          first_in: noTimeStatus ? null : (computed.first_in || null),
          last_out: noTimeStatus ? null : (computed.last_out || null),
          work_hours: computed.work_hours || 0,
          break_minutes: computed.break_minutes || 0,
          late_minutes: computed.late_minutes || 0,
          early_out_minutes: computed.early_out_minutes || 0,
          overtime_minutes: computed.overtime_minutes || 0,
                    shift: shift || "General (9:45 AM – 7:00 PM)",

          remark: remark || "",
          method: "hr_manual",
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
//  ADD SINGLE PUNCH  (HR)
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
      time: new Date(time),
      method: "hr_manual",
      remark: remark || "",
    });

    const computed = computeFromPunches(record.punches, record.shift || "");
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

    const computed = computeFromPunches(record.punches, record.shift || "");
Object.assign(record, computed);

    await record.save();
    res.json({ success: true, message: "Punch deleted", data: record });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ══════════════════════════════════════════
//  EXPORT EXCEL  (HR)
//  ✅ UPDATED: Break Out, Break In, Break Late columns added
// ══════════════════════════════════════════
exports.exportExcel = async (req, res) => {
  try {
    const ExcelJS = require("exceljs");

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const monthStr = String(month).padStart(2, "0");
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long" });

    // ── 1. Fetch employees ────────────────────────────────────
    const empFilter = req.query.employee_id
      ? { _id: req.query.employee_id }
      : { status: { $in: ["active", "approved"] } };
    const employees = await Employee.find(empFilter).lean();

    // ── 2. Fetch all attendance records for this month ────────
    const startDate = `${year}-${monthStr}-01`;
    const endDate = `${year}-${monthStr}-${String(daysInMonth).padStart(2, "0")}`;

    const recFilter = req.query.employee_id
      ? { date: { $gte: startDate, $lte: endDate }, employee_id: req.query.employee_id }
      : { date: { $gte: startDate, $lte: endDate } };
    const allRecords = await Attendance.find(recFilter).lean();

    const recMap = {};
    for (const r of allRecords) {
      const key = `${r.employee_id.toString()}_${r.date}`;
      recMap[key] = r;
    }

    // ── 3. Helper: format minutes → "1h 05m" or "45m" ────────
    const fmtMins = (mins) => {
      if (!mins || mins <= 0) return "—";
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
    };

    // ── 4. Helper: format Date → "09:45 am" ──────────────────
    const fmtTime = (d) => {
      if (!d) return "—";
      return new Date(d).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    };

    // ── 5. Helper: resolve first_in / last_out from punches ──
const resolveInOut = (rec) => {
  let firstIn = null;
  let lastOut = null;

  // ✅ Punches இருந்தா அதிலிருந்தே எடு — DB field நம்பாதே
  if (rec.punches?.length) {
    const sorted = [...rec.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
    const inPunches  = sorted.filter(p => p.type === "in");
    const outPunches = sorted.filter(p => p.type === "out");
    firstIn = inPunches[0]?.time  || null;
    lastOut = outPunches[outPunches.length - 1]?.time || null;
  }

  // ✅ Punches இல்லாட்டா மட்டும் DB field use பண்ணு
  if (!firstIn) firstIn = rec.first_in || rec.checkIn || null;
  if (!lastOut) lastOut = rec.last_out || rec.checkOut || null;

  return { firstIn, lastOut };
};

    // ── 6. Helper: compute work hours string ─────────────────
    const fmtWorkHrs = (rec, firstIn, lastOut) => {
      if (rec.work_hours && rec.work_hours > 0) {
        const h = Math.floor(rec.work_hours);
        const m = Math.round((rec.work_hours - h) * 60);
        return `${h}h ${String(m).padStart(2, "0")}m`;
      }
      if (firstIn && lastOut) {
        const diff = (new Date(lastOut) - new Date(firstIn)) / 3600000;
        const h = Math.floor(diff);
        const m = Math.round((diff % 1) * 60);
        return `${h}h ${String(m).padStart(2, "0")}m`;
      }
      return "—";
    };

    // ── 7. ✅ NEW: Break punch resolver ────────────────────────
    // Break window: 1:30 PM (810 mins) to 2:30 PM (870 mins)
    const BREAK_START_MINS = 13 * 60 + 30; // 810
    const BREAK_END_MINS = 14 * 60 + 30; // 870

    const toMinsFromDate = (d) => {
      const dt = new Date(d);
      return dt.getHours() * 60 + dt.getMinutes();
    };

    /**
     * resolveBreak(rec)
     * Returns { breakOut, breakIn, breakLateMins }
     *
     * Logic:
     *  - breakOut = first "out" punch whose time falls in 1:30–2:30 PM window
     *  - breakIn  = the next "in" punch after that breakOut (any time)
     *  - breakLateMins = if breakIn is after 2:30 PM → minutes past 2:30 PM
     */
    const resolveBreak = (rec) => {
      if (!rec.punches || rec.punches.length === 0) {
        return { breakOut: null, breakIn: null, breakLateMins: 0 };
      }

      const sorted = [...rec.punches].sort((a, b) => new Date(a.time) - new Date(b.time));

      // Find the first "out" punch inside the lunch window
      const breakOutPunch = sorted.find(
        (p) => p.type === "out" && toMinsFromDate(p.time) >= BREAK_START_MINS && toMinsFromDate(p.time) <= BREAK_END_MINS
      );

      if (!breakOutPunch) {
        return { breakOut: null, breakIn: null, breakLateMins: 0 };
      }

      // Find the next "in" punch after the breakOut punch time
      const breakOutTime = new Date(breakOutPunch.time);
      const breakInPunch = sorted.find(
        (p) => p.type === "in" && new Date(p.time) > breakOutTime
      );

      let breakLateMins = 0;
      if (breakInPunch) {
        const breakInMins = toMinsFromDate(breakInPunch.time);
        if (breakInMins > BREAK_END_MINS) {
          breakLateMins = breakInMins - BREAK_END_MINS;
        }
      }

      return {
        breakOut: breakOutPunch ? breakOutPunch.time : null,
        breakIn: breakInPunch ? breakInPunch.time : null,
        breakLateMins,
      };
    };

    // ── 8. Build workbook ─────────────────────────────────────
    const wb = new ExcelJS.Workbook();
    wb.creator = "HR Attendance System";
    wb.created = new Date();

    const isSingleEmployee = !!req.query.employee_id;

    // ─────────────────────────────────────────────────────────
    //  SUMMARY SHEET  (skipped for single-employee export)
    // ─────────────────────────────────────────────────────────
    let summarySheet;
    if (!isSingleEmployee) {
      summarySheet = wb.addWorksheet("Summary", {
        views: [{ state: "frozen", ySplit: 4 }],
      });

      summarySheet.mergeCells("A1:L1");
      summarySheet.getCell("A1").value = `Employee Attendance Report — ${monthName} ${year}`;
      summarySheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
      summarySheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
      summarySheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
      summarySheet.getRow(1).height = 36;

      summarySheet.mergeCells("A2:L2");
      summarySheet.getCell("A2").value = `Generated on ${new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })}`;
      summarySheet.getCell("A2").font = { size: 11, color: { argb: "FF6B7280" }, italic: true };
      summarySheet.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      summarySheet.getCell("A2").alignment = { horizontal: "center" };
      summarySheet.getRow(2).height = 22;

      summarySheet.getRow(3).height = 8;

      const summaryHeaders = [
        "#", "Employee Name", "Emp ID", "Department",
        "Work Days", "Present", "Late", "Half Day",
        "On Leave", "Absent", "OT Days", "Attendance %"
      ];
      const summaryHeaderRow = summarySheet.getRow(4);
      summaryHeaders.forEach((h, i) => {
        const cell = summaryHeaderRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 11, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: false };
        cell.border = { bottom: { style: "medium", color: { argb: "FF374151" } } };
      });
      summaryHeaderRow.height = 28;

      const summaryColWidths = [5, 22, 12, 18, 10, 9, 9, 10, 10, 9, 9, 14];
      summaryColWidths.forEach((w, i) => {
        summarySheet.getColumn(i + 1).width = w;
      });
    }

    // ─────────────────────────────────────────────────────────
    //  PER-EMPLOYEE SHEETS
    // ─────────────────────────────────────────────────────────
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

    employees.forEach((emp, empIdx) => {
      const empIdStr = emp._id.toString();

      let presentCount = 0, lateCount = 0, absentCount = 0;
      let halfCount = 0, leaveCount = 0, otCount = 0;
      let workDays = 0;
      let totalBreakLate = 0;
      let totalLateIn = 0;
      let totalEarlyOut = 0;

      const dayRows = [];

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${monthStr}-${String(d).padStart(2, "0")}`;
        const dayOfWeek = new Date(year, month - 1, d).getDay();
        const isWeekend = dayOfWeek === 0; // Sunday மட்டும்

        if (isWeekend) {
          dayRows.push({
            dateStr, dayName: dayNames[dayOfWeek],
            status: "Weekend", checkIn: "—", checkOut: "—",
            workHrs: "—", late: "—", ot: "—",
            // ✅ Break columns — empty for weekends
            breakOut: "—", breakIn: "—", breakLate: "—",
            isWeekend: true,
          });
          continue;
        }

        workDays++;
        const rec = recMap[`${empIdStr}_${dateStr}`];

        if (!rec) {
          absentCount++;
          dayRows.push({
            dateStr, dayName: dayNames[dayOfWeek],
            status: "Absent", checkIn: "—", checkOut: "—",
            workHrs: "—", late: "—", ot: "—",
            breakOut: "—", breakIn: "—", breakLate: "—",
            isWeekend: false,
          });
          continue;
        }

        const { firstIn, lastOut } = resolveInOut(rec);

let lateMin = 0;
let otMin = 0;
if (rec.punches && rec.punches.length > 0) {
  const computed = computeFromPunches(rec.punches, rec.shift || "");
  lateMin = computed.late_minutes || 0;
  otMin   = computed.overtime_minutes || 0;
} else {
  lateMin = rec.late_minutes || 0;
  otMin   = rec.overtime_minutes || 0;
}

        // ✅ Resolve break punches for this day
        const { breakOut, breakIn, breakLateMins } = resolveBreak(rec);

          const statusLabel = {
          present: "Present",
          late: "Present",     // ← late → Present (flags-ல் Late mins காட்டும்)
          absent: "Absent",
          half_day: "Half Day",
          leave: "On Leave",
          holiday: "Holiday",
        }[rec.status] || rec.status;

        if (rec.status === "present" || rec.status === "late") presentCount++;
        if (rec.status === "late" || lateMin > 0) lateCount++;
        if (rec.status === "half_day") halfCount++;
        if (rec.status === "leave") leaveCount++;
        if (rec.status === "absent") absentCount++;
        if (otMin > 0) otCount++;

        totalBreakLate += breakLateMins || 0;
        totalLateIn += rec.late_minutes || 0;
        totalEarlyOut += rec.early_out_minutes || 0;

        dayRows.push({
          dateStr,
          dayName: dayNames[dayOfWeek],
          status: statusLabel,
          checkIn: fmtTime(firstIn),
          checkOut: fmtTime(lastOut),
          workHrs: fmtWorkHrs(rec, firstIn, lastOut),
          late: fmtMins(lateMin),
          ot: fmtMins(rec.early_out_minutes || 0),
          // ✅ Break columns
          breakOut: breakOut ? fmtTime(breakOut) : "—",
          breakIn: breakIn ? fmtTime(breakIn) : "—",
          breakLate: breakLateMins > 0 ? fmtMins(breakLateMins) : "—",
          isWeekend: false,
          rawStatus: rec.status,
        });
      }

      const totalPresent = presentCount + halfCount;
      const attendancePct = workDays > 0
        ? ((totalPresent / workDays) * 100).toFixed(1) + "%"
        : "—";

      // ── Summary row (full company export only) ─────────────
      if (!isSingleEmployee && summarySheet) {
        const sRow = summarySheet.addRow([
          empIdx + 1,
          emp.name || "—",
          emp.employeeId || emp.employee_code || "—",
          emp.department || "—",
          workDays,
          presentCount,
          lateCount,
          halfCount,
          leaveCount,
          absentCount,
          otCount,
          attendancePct,
        ]);
        sRow.height = 22;
        sRow.eachCell((cell) => {
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = { bottom: { style: "thin", color: { argb: "FFF1F5F9" } } };
          cell.font = { size: 10 };
        });
        sRow.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
        sRow.getCell(2).font = { bold: true, size: 10 };

        const pctCell = sRow.getCell(12);
        const pctNum = parseFloat(attendancePct);
        if (!isNaN(pctNum)) {
          if (pctNum >= 90) pctCell.font = { bold: true, color: { argb: "FF16A34A" }, size: 10 };
          else if (pctNum >= 75) pctCell.font = { bold: true, color: { argb: "FFD97706" }, size: 10 };
          else pctCell.font = { bold: true, color: { argb: "FFDC2626" }, size: 10 };
        }
        if (empIdx % 2 === 1) {
          sRow.eachCell(cell => {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
          });
        }
      }

      // ── Per-employee sheet ─────────────────────────────────
      const sheetName = (emp.name || `Emp${empIdx + 1}`).substring(0, 28).replace(/[:\\/?*[\]]/g, "_");
      const ws = wb.addWorksheet(sheetName, {
        views: [{ state: "frozen", ySplit: 5 }],
      });

      // Row 1 — Employee Name (dark header)
      ws.mergeCells("A1:K1");
      ws.getCell("A1").value = emp.name || "—";
      ws.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
      ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
      ws.getCell("A1").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(1).height = 34;

      // Row 2 — Employee meta info
      ws.mergeCells("A2:K2");
      ws.getCell("A2").value = `${emp.employeeId || emp.employee_code || "—"}  |  ${emp.department || "—"}  |  ${monthName} ${year}`;
      ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };
      ws.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      ws.getCell("A2").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(2).height = 20;

      // Row 3 — Summary counts
      ws.mergeCells("A3:K3");
      ws.getCell("A3").value =
        `Present: ${presentCount}   Late: ${lateCount}   Absent: ${absentCount}   Half Day: ${halfCount}   On Leave: ${leaveCount}   OT Days: ${otCount}   Attendance: ${attendancePct}`;
      ws.getCell("A3").font = { size: 10, bold: true, color: { argb: "FF1F2937" } };
      ws.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      ws.getCell("A3").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(3).height = 22;

      // Row 4 — spacer
      ws.getRow(4).height = 8;

      // Row 5 — Column headers
      // ✅ UPDATED: 11 columns now (added Break Out, Break In, Break Late)
      const colHeaders = [
        "Date", "Day", "Status",
        "Check In", "Check Out", "Work Hrs",
        "Break Out", "Break In", "Break Late",
        "Late", "Early Out",
      ];
      const headerRow = ws.getRow(5);
      colHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };

        // ✅ Break columns get a distinct teal background to stand out
        const isBreakCol = i >= 6 && i <= 8;
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: isBreakCol ? "FF0F4C75" : "FF1F2937" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { bottom: { style: "medium", color: { argb: "FF374151" } } };
      });
      headerRow.height = 24;

      // ✅ Column widths for 11 columns
      // Date, Day, Status, CheckIn, CheckOut, WorkHrs, BreakOut, BreakIn, BreakLate, Late, OT
      [12, 8, 12, 11, 11, 10, 11, 11, 11, 10, 10].forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });

      // Status colour map
      const statusColors = {
        "Present": { bg: "FFD1FAE5", fg: "FF065F46" },
        "Late": { bg: "FFFEF9C3", fg: "FF92400E" },
        "Absent": { bg: "FFFEE2E2", fg: "FF991B1B" },
        "Half Day": { bg: "FFEDE9FE", fg: "FF5B21B6" },
        "On Leave": { bg: "FFE0F2FE", fg: "FF0C4A6E" },
        "Holiday": { bg: "FFFCE7F3", fg: "FF9D174D" },
        "Weekend": { bg: "FFF1F5F9", fg: "FF94A3B8" },
      };

      // Data rows
      dayRows.forEach((dr) => {
        const row = ws.addRow([
          dr.dateStr,
          dr.dayName,
          dr.status,
          dr.checkIn,
          dr.checkOut,
          dr.workHrs,
          dr.breakOut,    // ✅ col 7
          dr.breakIn,     // ✅ col 8
          dr.breakLate,   // ✅ col 9
          dr.late,        // col 10
          dr.ot,          // col 11
        ]);
        row.height = 20;

        const sc = statusColors[dr.status] || statusColors["Absent"];

        row.eachCell((cell, colNum) => {
          cell.font = { size: 10 };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = { bottom: { style: "thin", color: { argb: "FFF1F5F9" } } };

          // Weekend rows — grey + faded
          if (dr.isWeekend) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
            cell.font = { size: 10, color: { argb: "FFCBD5E1" } };
            return;
          }

          // Status cell (col 3) — coloured badge style
          if (colNum === 3) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sc.bg } };
            cell.font = { size: 10, bold: true, color: { argb: sc.fg } };
          }

          // ✅ Break Out (col 7) — light blue tint
          if (colNum === 7 && dr.breakOut !== "—") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
            cell.font = { size: 10, bold: true, color: { argb: "FF0369A1" } };
          }

          // ✅ Break In (col 8) — light blue tint
          if (colNum === 8 && dr.breakIn !== "—") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
            cell.font = { size: 10, bold: true, color: { argb: "FF0369A1" } };
          }

          // ✅ Break Late (col 9) — orange/amber highlight when late
          if (colNum === 9 && dr.breakLate !== "—") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
            cell.font = { size: 10, bold: true, color: { argb: "FFB45309" } };
          }

          // Late arrival (col 10)
          if (colNum === 10 && dr.late !== "—") {
            cell.font = { size: 10, bold: true, color: { argb: "FFB45309" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
          }

          // Early Out (col 11)
if (colNum === 11 && dr.ot !== "—") {
  cell.font = { size: 10, bold: true, color: { argb: "FF991B1B" } };
  cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
}
        });

        row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
      });

      // Totals footer row
      const totalsRow = ws.addRow(["", "", "TOTALS", "", "", "", "", "", "", "", ""]);
      totalsRow.height = 24;
      totalsRow.getCell(3).value = `P:${presentCount} L:${lateCount} A:${absentCount}`;
      totalsRow.getCell(9).value = totalBreakLate > 0 ? fmtMins(totalBreakLate) : "—";
      totalsRow.getCell(10).value = totalLateIn > 0 ? fmtMins(totalLateIn) : "—";
      totalsRow.getCell(11).value = totalEarlyOut > 0 ? fmtMins(totalEarlyOut) : "—";
      totalsRow.getCell(3).font = { bold: true, size: 10, color: { argb: "FF1F2937" } };
      totalsRow.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      totalsRow.getCell(3).alignment = { horizontal: "center" };
    });

    // ── Send file ─────────────────────────────────────────────
    const filename = isSingleEmployee && employees[0]
      ? `${employees[0].name}_Attendance_${monthName}_${year}.xlsx`.replace(/\s+/g, "_")
      : `Attendance_${monthName}_${year}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("exportExcel error:", err);
    res.status(500).json({ message: err.message });
  }
};

// ══════════════════════════════════════════
//  MIGRATION HELPER  (run once)
// ══════════════════════════════════════════
exports.migrateOldRecords = async (req, res) => {
  try {
    const old = await Attendance.find({
      checkIn: { $exists: true, $ne: null },
      $or: [{ punches: { $exists: false } }, { punches: { $size: 0 } }],
    });

    let migrated = 0;

    for (const rec of old) {
      const newPunches = [];
      if (rec.checkIn) newPunches.push({ type: "in", time: rec.checkIn, method: rec.method || "manual" });
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