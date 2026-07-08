const mongoose = require("mongoose");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const LeaveRequest = require("../models/LeaveRequest");
// ══════════════════════════════════════════
//  FIXED TIMING CONFIG (No Shift - Hardcoded 10:00 AM to 7:00 PM)
// ══════════════════════════════════════════
const DEFAULT_SHIFT_START = 10 * 60;
const DEFAULT_SHIFT_END = 19 * 60;
const HALF_DAY_CUTOFF = 11 * 60 + 30; // 690 = 11:30 AM
const LUNCH_START = 13 * 60 + 30;     // 810 = 1:30 PM
const LUNCH_END = 14 * 60 + 30;       // 870 = 2:30 PM
const LUNCH_RETURN_CUTOFF = 15 * 60;   // ✅ ADD THIS — 3:00 PM


const parseShiftMins = (emp) => {
  if (emp?.shift?.start && emp?.shift?.end) {
    const [sh, sm] = emp.shift.start.split(":").map(Number);
    const [eh, em] = emp.shift.end.split(":").map(Number);
    return { startMins: sh * 60 + sm, endMins: eh * 60 + em };
  }
  return { startMins: DEFAULT_SHIFT_START, endMins: DEFAULT_SHIFT_END };
};


const toMins = (date) => {
  const d = new Date(new Date(date).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return d.getHours() * 60 + d.getMinutes();
};
const todayStr = () => new Date().toISOString().split("T")[0];
// ══════════════════════════════════════════
//  CORE HELPERS
// ══════════════════════════════════════════
const GRACE_MINUTES = 15;  // ← இத Add பண்ணு (Line 20-க்கு மேல)

const getLateMinutes = (firstIn, shiftStartMins = DEFAULT_SHIFT_START) => {
  if (!firstIn) return 0;
  const mins = toMins(firstIn);
  if (mins >= LUNCH_START && mins <= LUNCH_END) return 0;
  return Math.max(mins - shiftStartMins, 0);
};

const getEarlyOutMinutes = (lastOut, shiftEndMins = DEFAULT_SHIFT_END) => {
  if (!lastOut) return 0;
  const mins = toMins(lastOut);
  
  // 12:00 AM (midnight) = 0 → employee worked past midnight, not early out
  if (mins === 0) return 0;
  
  // Checkout after shift end → no early out
  if (mins >= shiftEndMins) return 0;
  
  return Math.max(shiftEndMins - mins, 0);
};

const getOvertimeMinutes = (lastOut, shiftEndMins = DEFAULT_SHIFT_END) => {
  if (!lastOut) return 0;
  return Math.max(toMins(lastOut) - shiftEndMins, 0);
};

// ══════════════════════════════════════════
//  BREAK PUNCH RESOLVER (GLOBAL)
// ══════════════════════════════════════════
const BREAK_START_MINS = 13 * 60 + 30; // 810 = 1:30 PM
const BREAK_END_MINS = 14 * 60 + 30;   // 870 = 2:30 PM

const toMinsFromDate = (d) => {
  const dt = new Date(new Date(d).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  return dt.getHours() * 60 + dt.getMinutes();
};

const resolveBreak = (punches) => {
  if (!punches || punches.length === 0) {
    return { breakOut: null, breakIn: null, breakLateMins: 0 };
  }
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const breakOutIdx = sorted.findIndex(
    (p) => p.type === "out" && toMinsFromDate(p.time) >= BREAK_START_MINS && toMinsFromDate(p.time) <= BREAK_END_MINS
  );
  if (breakOutIdx === -1) return { breakOut: null, breakIn: null, breakLateMins: 0 };

  const breakOutPunch = sorted[breakOutIdx];
  const breakOutTime = new Date(breakOutPunch.time);
  const breakInPunch = sorted.slice(breakOutIdx + 1).find(
    (p) => p.type === "in" && new Date(p.time) > breakOutTime
  );

  let breakLateMins = 0;
  if (breakInPunch) {
    const breakInMins = toMinsFromDate(breakInPunch.time);
    if (breakInMins > BREAK_END_MINS) breakLateMins = breakInMins - BREAK_END_MINS;
  }

  return {
    breakOut: breakOutPunch.time,
    breakIn: breakInPunch ? breakInPunch.time : null,
    breakLateMins,
  };
};

const isStuckOnLunch = (punches, dateStr) => {
  if (!punches || punches.length === 0) return false;
  const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
  const last = sorted[sorted.length - 1];
  if (!last || last.type !== "out") return false;

  const outMins = toMinsFromDate(last.time);
  const isLunchOut = outMins >= LUNCH_START && outMins <= LUNCH_END;
  if (!isLunchOut) return false;

  const today = todayStr();
  if (dateStr === today) {
    const nowMins = toMins(new Date());
    return nowMins >= LUNCH_RETURN_CUTOFF;
  }
  return true; // past date already over → cutoff passed
};


// ══════════════════════════════════════════
//  PUNCH CALCULATION ENGINE
// ══════════════════════════════════════════
const computeFromPunches = (punches, shiftStartMins = DEFAULT_SHIFT_START, shiftEndMins = DEFAULT_SHIFT_END, permission = null, dateStr = todayStr()) => {
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

  const workHours = Math.max(0, parseFloat((netWorkMs / 3600000).toFixed(2)));
  const breakMinutes = Math.round(breakMs / 60000);

  // ✅ PERMISSION LOGIC: if first-in falls within permission window, treat
  // permission end time as the effective shift start for late/status calc.
  let effectiveStartMins = shiftStartMins;
  let permissionApplied = false;
  if (permission?.end && firstIn) {
    const [ph, pm] = permission.end.split(":").map(Number);
    const permissionEndMins = ph * 60 + pm;
    const firstInMinsCheck = toMins(firstIn);
    if (firstInMinsCheck <= permissionEndMins) {
      effectiveStartMins = permissionEndMins;
      permissionApplied = true;
    }
  }

  const lateMinutes = getLateMinutes(firstIn, effectiveStartMins);
  const earlyOutMinutes = getEarlyOutMinutes(lastOut, shiftEndMins);
  const overtimeMinutes = getOvertimeMinutes(lastOut, shiftEndMins);

  let status = "absent";
  if (firstIn) {
    const firstInMins = toMins(firstIn);

    const HALF_DAY_START = 12 * 60;
    const HALF_DAY_END = 15 * 60;

    if (firstInMins <= effectiveStartMins + 15) {
      status = "present";
    } else if (firstInMins <= effectiveStartMins + 90) {
      status = "late";
    } else if (firstInMins >= HALF_DAY_START && firstInMins <= HALF_DAY_END) {
      status = "half_day";
    } else if (firstInMins > HALF_DAY_END) {
      status = "absent";
    } else {
      status = "half_day";
    }
  }
  const hasAnyIn = sorted.some(p => p.type === "in");
  if (!hasAnyIn && sorted.some(p => p.type === "out")) {
    status = "absent";
  }

  if (status !== "absent" && status !== "leave") {
    if (isStuckOnLunch(sorted, dateStr)) {
      status = "half_day";
    }
  }

  const isCurrentlyIn = lastInTime !== null;

  return {
    first_in: firstIn,
    last_out: isCurrentlyIn ? null : lastOut,  // ← KEY FIX
    work_hours: workHours,
    break_minutes: breakMinutes,
    late_minutes: lateMinutes,
    early_out_minutes: earlyOutMinutes,
    overtime_minutes: overtimeMinutes,
    status,
    is_currently_in: isCurrentlyIn,
    permission_applied: permissionApplied,
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

      record = new Attendance({
        employee_id,
        date: today,
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

    const emp = await Employee.findById(employee_id).select("shift").lean();
    const { startMins, endMins } = parseShiftMins(emp);
    const computed = computeFromPunches(record.punches, startMins, endMins);
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

      const emp = await Employee.findById(employee_id).select("shift").lean();
      const { startMins, endMins } = parseShiftMins(emp);
      const computed = computeFromPunches(record.punches, startMins, endMins);
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

    const emp = await Employee.findById(employee_id).select("shift").lean();
    const { startMins, endMins } = parseShiftMins(emp);
    const computed = computeFromPunches(record.punches, startMins, endMins); Object.assign(record, computed);

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

      obj.checkIn = obj.first_in || obj.checkIn || null;
      obj.checkOut = obj.last_out || null;

      const { breakOut, breakIn, breakLateMins } = resolveBreak(obj.punches || []);
      let actualCheckOut = null;
      if (obj.last_out && breakOut) {
        const lastOutTime = new Date(obj.last_out).getTime();
        const breakOutTime = new Date(breakOut).getTime();
        if (lastOutTime === breakOutTime) {
          const sortedPunches = [...(obj.punches || [])].sort((a, b) => new Date(a.time) - new Date(b.time));
          const breakInTime = breakIn ? new Date(breakIn).getTime() : 0;
          const afterBreakOut = sortedPunches.find(p => p.type === "out" && new Date(p.time).getTime() > breakInTime);
          actualCheckOut = afterBreakOut ? afterBreakOut.time : null;
        } else {
          actualCheckOut = obj.last_out;
        }
      } else if (obj.last_out) {
        actualCheckOut = obj.last_out;
      }
      obj.checkOut = actualCheckOut;
      obj.breakOut = breakOut;
      obj.breakIn = breakIn;
      obj.breakLate = breakLateMins;

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
    const mNum = new Date().getMonth() + 1;
    const m = String(mNum).padStart(2, "0");
    const daysInMonth = new Date(y, mNum, 0).getDate();

    const records = await Attendance.find({
      employee_id: employeeId,
      date: {
        $gte: `${y}-${m}-01`,
        $lte: `${y}-${m}-${String(daysInMonth).padStart(2, "0")}`,
      },
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
    const empDoc = await Employee.findById(employeeId).select("shift").lean();
    const { startMins, endMins } = parseShiftMins(empDoc);


    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId required" });
    }

    const y = year || new Date().getFullYear();
    const m = month || new Date().getMonth() + 1;
    const daysInMonth = new Date(y, m, 0).getDate();

    const query = {
      date: {
        $gte: `${y}-${String(m).padStart(2, "0")}-01`,
        $lte: `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
      }
    };

    if (mongoose.Types.ObjectId.isValid(employeeId)) {
      query.$or = [
        { employee_id: employeeId },
        { employee_id: new mongoose.Types.ObjectId(employeeId) }
      ];
    } else {
      query.employee_id = employeeId;
    }

    const records = await Attendance.find(query).sort({ date: 1 });

    const enriched = records.map(r => {
      const obj = r.toObject();

      if (obj.punches && obj.punches.length > 0) {
        const sorted = [...obj.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
        const { breakOut, breakIn, breakLateMins } = resolveBreak(sorted);
       const computed = computeFromPunches(sorted, startMins, endMins, obj.permission || null, obj.date);

        let actualCheckOut = null;
        if (computed.last_out) {
          const lastOutTime = new Date(computed.last_out).getTime();
          const breakOutTime = breakOut ? new Date(breakOut).getTime() : 0;
          actualCheckOut = (lastOutTime === breakOutTime) ? null : computed.last_out;
        }

        obj.first_in = computed.first_in || obj.first_in || null;
        obj.last_out = computed.last_out || obj.last_out || null;
        obj.checkIn = computed.first_in || obj.checkIn || null;
        obj.checkOut = actualCheckOut || obj.checkOut || null;
        obj.breakOut = breakOut;
        obj.breakIn = breakIn;
        obj.breakLate = breakLateMins;
        obj.work_hours = computed.work_hours;
        obj.late_minutes = computed.late_minutes;
        obj.early_out_minutes = computed.early_out_minutes;
        obj.overtime_minutes = computed.overtime_minutes;
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
      Attendance.find({ date }).populate("employee_id", "name employeeId employee_code department designation shift"),
      Employee.find({ status: { $in: ["active", "approved"] } }, "name employeeId employee_code department designation shift"),
    ]);

    const recordMap = {};
    // ✅ FIXED:
    records.forEach(r => {
      if (!r.employee_id) return;
      const key = r.employee_id._id?.toString() || r.employee_id.toString();
      recordMap[key] = r;
    });

    const BREAK_START_MINS = 13 * 60 + 30;
    const BREAK_END_MINS = 14 * 60 + 30;
    const toMinsLocal = (d) => {
      const dt = new Date(new Date(d).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      return dt.getHours() * 60 + dt.getMinutes();
    };
    const resolveBreakLocal = (punches) => {
      if (!punches || punches.length === 0) return { breakOut: null, breakIn: null, breakLateMins: 0 };
      const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
      const breakOutIdx = sorted.findIndex((p) => p.type === "out" && toMinsLocal(p.time) >= BREAK_START_MINS && toMinsLocal(p.time) <= BREAK_END_MINS);
      if (breakOutIdx === -1) return { breakOut: null, breakIn: null, breakLateMins: 0 };
      const breakOutPunch = sorted[breakOutIdx];
      const breakOutTime = new Date(breakOutPunch.time);
      const breakInPunch = sorted.slice(breakOutIdx + 1).find((p) => p.type === "in" && new Date(p.time) > breakOutTime);
      let breakLateMins = 0;
      if (breakInPunch) {
        const breakInMins = toMinsLocal(breakInPunch.time);
        if (breakInMins > BREAK_END_MINS) breakLateMins = breakInMins - BREAK_END_MINS;
      }
      return { breakOut: breakOutPunch.time, breakIn: breakInPunch ? breakInPunch.time : null, breakLateMins };
    };

    const result = await Promise.all(employees.map(async (emp) => {
      const { startMins, endMins } = parseShiftMins(emp);

      const rec = recordMap[emp._id.toString()];

      if (rec) {
        const obj = rec.toObject();


        if (obj.punches && obj.punches.length > 0) {
  const { startMins, endMins } = parseShiftMins(emp);
  const computed = computeFromPunches(obj.punches, startMins, endMins, obj.permission || null, obj.date);
  Object.assign(obj, computed);
}
        obj.employee = emp;
const { endMins } = parseShiftMins(emp);
const nowMins = new Date().getHours() * 60 + new Date().getMinutes();
obj.missing_punch = obj.is_currently_in && 
  (date !== todayStr() ? true : nowMins >= endMins);
  
        obj.checkIn = obj.first_in || obj.checkIn || null;
        const { breakOut, breakIn, breakLateMins } = resolveBreakLocal(obj.punches || []);
        // Simple fix: last_out dhan actual check-out
        obj.checkOut = obj.last_out || null;
        obj.breakOut = breakOut;
        obj.breakIn = breakIn;
        obj.breakLate = breakLateMins;

        return obj;
      }

      return {
        employee_id: emp._id,
        employee: emp,
        date,
        status: "absent",
        // shift: emp.shift || "General (10:00 – 19:00)",  // ← IDHU ADD PANNANUM
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
    }));

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
    const daysInMonth = new Date(y, m, 0).getDate();

    const [employees, records] = await Promise.all([
      Employee.find({ status: { $in: ["active", "approved"] } }, "name employeeId employee_code department shift"),
      Attendance.find({
        date: {
          $gte: `${y}-${String(m).padStart(2, "0")}-01`,
          $lte: `${y}-${String(m).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
        },
      }),
    ]);

    let workingDays = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const day = new Date(y, m - 1, d).getDay();
      if (day !== 0) workingDays++;
    }

    const todayS = todayStr();

    // ✅ Shift docs preload for getMonthlyReport
    const result = await Promise.all(employees.map(async (emp) => {
      const empRecs = records.filter(r => {
        if (!r.employee_id) return false;
        return r.employee_id.toString() === emp._id.toString();
      });

      const enriched = empRecs.map(r => {
        const obj = r.toObject ? r.toObject() : { ...r };


        if (obj.punches && obj.punches.length > 0) {
          const sorted = [...obj.punches].sort((a, b) => new Date(a.time) - new Date(b.time));
          const { startMins, endMins } = parseShiftMins(emp);
          const c = computeFromPunches(sorted, startMins, endMins, obj.permission || null, obj.date)
          const { breakOut, breakIn, breakLateMins } = resolveBreak(sorted);

          let actualCheckOut = null;
          if (c.last_out) {
            const lastOutTime = new Date(c.last_out).getTime();
            const breakOutTime = breakOut ? new Date(breakOut).getTime() : 0;
            actualCheckOut = (lastOutTime === breakOutTime) ? null : c.last_out;
          }

          return { ...obj, ...c, checkOut: actualCheckOut, breakOut, breakIn, breakLate: breakLateMins };
        }

        // ✅ Punches இல்லாட்டாலும் DB status recalculate பண்ணு
        if (obj.first_in || obj.checkIn) {
          const fakeIn = obj.first_in || obj.checkIn;
          const fakeOut = obj.last_out || obj.checkOut;
          const fakePunches = [
            { type: "in", time: fakeIn },
            ...(fakeOut ? [{ type: "out", time: fakeOut }] : []),
          ];
          const c = computeFromPunches(fakePunches, startMins, endMins);
          return { ...obj, status: c.status, late_minutes: c.late_minutes };
        }

        return obj;
      });

      const present = enriched.filter(r => r.status === "present" || r.status === "late").length;
      const late = enriched.filter(r =>
        r.status === "late" ||
        (r.status === "present" && (r.late_minutes || 0) > 0)
      ).length;
      const half_day = enriched.filter(r => r.status === "half_day").length;
      const on_leave = enriched.filter(r => r.status === "leave").length;
      const absent = Math.max(workingDays - present - half_day - on_leave, 0);

      const totalHrs = enriched.reduce((s, r) => s + (r.work_hours || 0), 0);
      const avgHoursNum = enriched.length ? parseFloat((totalHrs / enriched.length).toFixed(1)) : 0;
      const avgHours = enriched.length ? avgHoursNum + "h" : "—";

      const totalLateMins = enriched.reduce((s, r) => s + (r.late_minutes || 0), 0);
      const overtimeDays = 0; // OT feature removed
      const earlyOutDays = enriched.filter(r => (r.early_out_minutes || 0) > 0).length;
      const missingPunch = enriched.filter(r => r.is_currently_in && r.date !== todayS).length;

     const leave_for_pct = enriched.filter(r => 
  r.status === "leave" && r.method === "hr_manual"
).length;

const pct = workingDays
  ? Math.round(((present + half_day * 0.5 + leave_for_pct) / workingDays) * 100)
  : 0;

      return {
        _id: emp._id,
        name: emp.name,
        employeeId: emp.employeeId,
        shift: emp.shift || null,
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
    }));

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
    const { employee_id, date, status, checkIn, checkOut, punches, remark , permissionStart, permissionEnd } = req.body;

    // ✅ Checkout must be after checkin validation
    if (checkIn && checkOut) {
      if (new Date(checkOut) <= new Date(checkIn)) {
        return res.status(400).json({
          success: false,
          message: "Check-out time must be after check-in time"
        });
      }
    }

const noTimeStatus = ["leave", "holiday", "weekend", "absent"].includes(status);

let newPunches = []; // ← எப்பவும் fresh start

if (!noTimeStatus) {
  if (punches && Array.isArray(punches) && punches.length > 0) {
    newPunches = punches.map(p => ({
      type: p.type,
      time: new Date(p.time),
      method: "hr_manual",
      remark: p.remark || "",
    }));
  } else if (checkIn) {
    newPunches.push({
      type: "in",
      time: new Date(checkIn),
      method: "hr_manual",
      remark: remark || "",
    });
    if (checkOut) {
      newPunches.push({
        type: "out",
        time: new Date(checkOut),
        method: "hr_manual",
        remark: remark || "",
      });
    }
  }
}

newPunches.sort((a, b) => new Date(a.time) - new Date(b.time));

    const emp2 = await Employee.findById(employee_id).select("shift").lean();
    const { startMins, endMins } = parseShiftMins(emp2);

     const permission = (permissionStart && permissionEnd)
      ? { start: permissionStart, end: permissionEnd }
      : null;

    const computed = newPunches.length > 0
      ? computeFromPunches(newPunches, startMins, endMins)
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
          checkIn: noTimeStatus ? null : (computed.first_in || null),
          checkOut: noTimeStatus ? null : (computed.last_out || null),
          work_hours: computed.work_hours || 0,
          break_minutes: computed.break_minutes || 0,
          late_minutes: computed.late_minutes || 0,
          early_out_minutes: computed.early_out_minutes || 0,
          overtime_minutes: computed.overtime_minutes || 0,
          remark: remark || "",
          method: "hr_manual",
            permission: permission,
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
//  HR SHIFT UPDATE
// ══════════════════════════════════════════
exports.updateEmployeeShift = async (req, res) => {
  try {
    const { id } = req.params;
    let { start, end } = req.body;

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "start and end required (HH:MM)"
      });
    }

    // ✅ "12:30 PM" → "12:30" OR "9:30" → "09:30" — எந்த format வந்தாலும் handle
    const normalizeTime = (t) => {
      if (!t) return null;
      t = t.trim();

      // "12:30 PM" format
      if (t.includes("AM") || t.includes("PM")) {
        const [time, meridiem] = t.split(" ");
        let [h, m] = time.split(":").map(Number);
        if (meridiem === "AM" && h === 12) h = 0;
        if (meridiem === "PM" && h !== 12) h += 12;
        return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
      }

      // "9:30" or "09:30" format
      const parts = t.split(":");
      const h = String(parseInt(parts[0])).padStart(2, "0");
      const m = String(parseInt(parts[1] || "0")).padStart(2, "0");
      return `${h}:${m}`;
    };

    start = normalizeTime(start);
    end = normalizeTime(end);

    if (!start || !end) {
      return res.status(400).json({
        success: false,
        message: "Invalid time format"
      });
    }

    const timeRegex = /^([0-1]?\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(start) || !timeRegex.test(end)) {
      return res.status(400).json({
        success: false,
        message: `Invalid time after normalize: "${start}", "${end}"`
      });
    }

    const emp = await Employee.findByIdAndUpdate(
      id,
      { $set: { "shift.start": start, "shift.end": end } },
      { new: true }
    ).select("name employeeId shift");

    if (!emp) {
      return res.status(404).json({
        success: false,
        message: "Employee not found"
      });
    }

    res.json({ success: true, message: "Shift updated", data: emp });
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

    const emp = await Employee.findById(employee_id).select("shift").lean();
const { startMins, endMins } = parseShiftMins(emp);
const computed = computeFromPunches(record.punches, startMins, endMins);
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

    const emp = await Employee.findById(employee_id).select("shift").lean();
const { startMins, endMins } = parseShiftMins(emp);
const computed = computeFromPunches(record.punches, startMins, endMins);
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

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const monthStr = String(month).padStart(2, "0");
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthName = new Date(year, month - 1).toLocaleString("en-US", { month: "long" });

    const empFilter = req.query.employee_id
      ? { _id: req.query.employee_id }
      : { status: { $in: ["active", "approved"] } };
    const employees = await Employee.find(empFilter).lean();

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

    const fmtMins = (mins) => {
  if (mins === null || mins === undefined || mins <= 0) return "—";
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
    };

    const fmtTime = (d) => {
      if (!d) return "—";
      return new Date(d).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata"
      });
    };

    // ── 5. Helper: resolve first_in / last_out from punches ──
    const resolveInOut = (rec) => {
      let firstIn = null;
      let lastOut = null;

      if (rec.punches?.length) {
        const sorted = [...rec.punches].sort((a, b) => new Date(a.time) - new Date(b.time));

        // Filter out break punches (1:30-2:30 PM)
        const BREAK_START_MINS = 13 * 60 + 30; // 810
        const BREAK_END_MINS = 14 * 60 + 30;   // 870

        const toMinsLocal = (d) => {
          const dt = new Date(new Date(d).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
          return dt.getHours() * 60 + dt.getMinutes();
        };

        const isBreakPunch = (p) => {
          if (p.type !== "out" && p.type !== "in") return false;
          const mins = toMinsLocal(p.time);
          return mins >= BREAK_START_MINS && mins <= BREAK_END_MINS;
        };

        const workPunches = sorted.filter(p => !isBreakPunch(p));
        const inPunches = workPunches.filter(p => p.type === "in");
        const outPunches = workPunches.filter(p => p.type === "out");

        firstIn = inPunches[0]?.time || null;
        lastOut = outPunches[outPunches.length - 1]?.time || null;
      }

      // ✅ Punches இல்லாட்டா மட்டும் DB field use பண்ணு
      if (!firstIn) firstIn = rec.first_in || rec.checkIn || null;
      if (!lastOut) lastOut = rec.last_out || rec.checkOut || null;

      return { firstIn, lastOut };
    };

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

    const BREAK_START_MINS = 13 * 60 + 30;
    const BREAK_END_MINS = 14 * 60 + 30;

    const toMinsFromDate = (d) => {
      // Convert to Asia/Kolkata timezone first
      const dt = new Date(new Date(d).toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
      return dt.getHours() * 60 + dt.getMinutes();
    };

    const resolveBreak = (rec) => {
      if (!rec.punches || rec.punches.length === 0) {
        return { breakOut: null, breakIn: null, breakLateMins: 0 };
      }

      const sorted = [...rec.punches].sort((a, b) => new Date(a.time) - new Date(b.time));

      const breakOutPunch = sorted.find(
        (p) => p.type === "out" && toMinsFromDate(p.time) >= BREAK_START_MINS && toMinsFromDate(p.time) <= BREAK_END_MINS
      );

      if (!breakOutPunch) {
        return { breakOut: null, breakIn: null, breakLateMins: 0 };
      }

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


    // ✅ Extra out→in pairs — lunch break-um final checkout-um illama, idhukku idhaiyila employee out/in pannirukkanga andha pairs ellam
    const resolveExtraPairs = (punches, breakOutTime) => {
      if (!punches || punches.length < 2) return [];
      const sorted = [...punches].sort((a, b) => new Date(a.time) - new Date(b.time));
      const breakOutMs = breakOutTime ? new Date(breakOutTime).getTime() : null;

      const pairs = [];
      for (let i = 0; i < sorted.length - 1; i++) {
        const cur = sorted[i];
        const next = sorted[i + 1];
        if (cur.type !== "out" || next.type !== "in") continue;

        const curMs = new Date(cur.time).getTime();
        if (breakOutMs && curMs === breakOutMs) continue; // lunch break pair-a skip pannu

        pairs.push({ out: cur.time, in: next.time });
      }
      return pairs;
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = "HR Attendance System";
    wb.created = new Date();

    const isSingleEmployee = !!req.query.employee_id;

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
        "On Leave", "Absent", "Total Late", "Attendance %"
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

      const summaryColWidths = [5, 22, 12, 18, 10, 9, 9, 10, 10, 9, 12, 14];// ← remove 9 (OT Days)
      summaryColWidths.forEach((w, i) => {
        summarySheet.getColumn(i + 1).width = w;
      });
    }

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
        const isWeekend = dayOfWeek === 0;

        if (isWeekend) {
          dayRows.push({
            dateStr, dayName: dayNames[dayOfWeek],
            status: "Weekend", checkIn: "—", checkOut: "—",
            workHrs: "—", late: "—", earlyOut: "—", ot: "—",
            breakOut: "—", breakIn: "—", breakLate: "—",
            extraOut: "—", extraIn: "—", extraCount: 0,
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
            workHrs: "—", late: "—", earlyOut: "—", ot: "—",
            breakOut: "—", breakIn: "—", breakLate: "—",
            extraOut: "—", extraIn: "—", extraCount: 0,
            isWeekend: false,
          });
          continue;
        }

        const { firstIn, lastOut } = resolveInOut(rec);

        let lateMin = 0;
        let otMin = 0;
        let earlyOutMin = 0;
        if (rec.punches && rec.punches.length > 0) {
          const { startMins, endMins } = parseShiftMins(emp);
          const computed = computeFromPunches(rec.punches, startMins, endMins, null, dateStr);
          lateMin = computed.late_minutes || 0;
          otMin = computed.overtime_minutes || 0;
          earlyOutMin = computed.early_out_minutes || 0;
        } else {
          lateMin = rec.late_minutes || 0;
          otMin = rec.overtime_minutes || 0;
          earlyOutMin = rec.early_out_minutes || 0;
        }

        const { breakOut, breakIn, breakLateMins } = resolveBreak(rec);


        const extraPairs = resolveExtraPairs(rec.punches, breakOut);
        const extraOutText = extraPairs.length ? extraPairs.map(p => fmtTime(p.out)).join("\n") : "—";
        const extraInText = extraPairs.length ? extraPairs.map(p => fmtTime(p.in)).join("\n") : "—";

        const statusLabel = {
          present: "Present",
          late: "Present",
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
        totalLateIn += lateMin || 0; 
        totalEarlyOut += earlyOutMin || 0;

        dayRows.push({
          dateStr,
          dayName: dayNames[dayOfWeek],
          status: statusLabel,
          checkIn: fmtTime(firstIn),
          checkOut: fmtTime(lastOut),
          workHrs: fmtWorkHrs(rec, firstIn, lastOut),
          late: fmtMins(lateMin),
          earlyOut: earlyOutMin > 0 ? fmtMins(earlyOutMin) : "—",
          breakOut: breakOut ? fmtTime(breakOut) : "—",
          breakIn: breakIn ? fmtTime(breakIn) : "—",
          breakLate: breakLateMins > 0 ? fmtMins(breakLateMins) : "—",
          extraOut: extraOutText,
          extraIn: extraInText,
          extraCount: extraPairs.length,
          isWeekend: false,
          rawStatus: rec.status,
          remark: rec.remark || "",
        });
      }

      const totalPresent = presentCount + halfCount + leaveCount;
      const attendancePct = workDays > 0
        ? ((totalPresent / workDays) * 100).toFixed(1) + "%"
        : "—";

      if (!isSingleEmployee && summarySheet) {
        const sRow = summarySheet.addRow([
  empIdx + 1, emp.name || "—", emp.employeeId || emp.employee_code || "—",
  emp.department || "—", workDays, presentCount, lateCount, halfCount,
  leaveCount, absentCount, totalLateIn > 0 ? fmtMins(totalLateIn) : "—", attendancePct,
]);
        sRow.height = 22;
        sRow.eachCell((cell) => {
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = { bottom: { style: "thin", color: { argb: "FFF1F5F9" } } };
          cell.font = { size: 10 };
        });
        sRow.getCell(2).alignment = { horizontal: "left", vertical: "middle" };
        sRow.getCell(2).font = { bold: true, size: 10 };

        const pctCell = sRow.getCell(11);
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

      const sheetName = (emp.name || `Emp${empIdx + 1}`).substring(0, 28).replace(/[:\\/?*[\]]/g, "_");
      const ws = wb.addWorksheet(sheetName, {
        views: [{ state: "frozen", ySplit: 5 }],
      });

      ws.mergeCells("A1:M1");
      ws.getCell("A1").value = emp.name || "—";
      ws.getCell("A1").font = { bold: true, size: 15, color: { argb: "FFFFFFFF" } };
      ws.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } };
      ws.getCell("A1").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(1).height = 34;

      ws.mergeCells("A2:M2");
      ws.getCell("A2").value = `${emp.employeeId || emp.employee_code || "—"}  |  ${emp.department || "—"}  |  ${monthName} ${year}`;
      ws.getCell("A2").font = { size: 10, color: { argb: "FF6B7280" } };
      ws.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF9FAFB" } };
      ws.getCell("A2").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(2).height = 20;

      ws.mergeCells("A3:M3");
      ws.getCell("A3").value =
        `Present: ${presentCount}   Late: ${lateCount}   Absent: ${absentCount}   Half Day: ${halfCount}   On Leave: ${leaveCount}   Attendance: ${attendancePct}`;
      ws.getCell("A3").font = { size: 10, bold: true, color: { argb: "FF1F2937" } };
      ws.getCell("A3").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      ws.getCell("A3").alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      ws.getRow(3).height = 22;

      ws.getRow(4).height = 8;

      const colHeaders = [
        "Date", "Day", "Status",
        "Check In", "Check Out", "Work Hrs",
        "Break Out", "Break In", "Break Late",
        "Late", "Early Out", "Extra Out", "Extra In",
      ];

      const headerRow = ws.getRow(5);
      colHeaders.forEach((h, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = h;
        cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };

        const isBreakCol = i >= 6 && i <= 8;
        cell.fill = {
          type: "pattern", pattern: "solid",
          fgColor: { argb: isBreakCol ? "FF0F4C75" : "FF1F2937" },
        };
        cell.alignment = { horizontal: "center", vertical: "middle" };
        cell.border = { bottom: { style: "medium", color: { argb: "FF374151" } } };
      });
      headerRow.height = 24;

      [12, 8, 12, 11, 11, 10, 11, 11, 11, 10, 11, 11, 11].forEach((w, i) => {
        ws.getColumn(i + 1).width = w;
      });

      const statusColors = {
        "Present": { bg: "FFD1FAE5", fg: "FF065F46" },
        "Late": { bg: "FFFEF9C3", fg: "FF92400E" },
        "Absent": { bg: "FFFEE2E2", fg: "FF991B1B" },
        "Half Day": { bg: "FFEDE9FE", fg: "FF5B21B6" },
        "On Leave": { bg: "FFE0F2FE", fg: "FF0C4A6E" },
        "Holiday": { bg: "FFFCE7F3", fg: "FF9D174D" },
        "Weekend": { bg: "FFF1F5F9", fg: "FF94A3B8" },
      };

      dayRows.forEach((dr) => {
        const row = ws.addRow([
          dr.dateStr,
          dr.dayName,
          dr.status,
          dr.checkIn,
          dr.checkOut,
          dr.workHrs,
          dr.breakOut,
          dr.breakIn,
          dr.breakLate,
          dr.late,
          dr.earlyOut,
          dr.extraOut,
          dr.extraIn,
        ]);
        const extraLines = Math.max(dr.extraCount || 0, 1);
        row.height = extraLines > 1 ? 16 * extraLines : 20;

        const sc = statusColors[dr.status] || statusColors["Absent"];

        row.eachCell((cell, colNum) => {
          cell.font = { size: 10 };
          cell.alignment = { horizontal: "center", vertical: "middle" };
          cell.border = { bottom: { style: "thin", color: { argb: "FFF1F5F9" } } };

          if (dr.isWeekend) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
            cell.font = { size: 10, color: { argb: "FFCBD5E1" } };
            return;
          }

          if (colNum === 3) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: sc.bg } };
            cell.font = { size: 10, bold: true, color: { argb: sc.fg } };
          }

          if (colNum === 7 && dr.breakOut !== "—") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
            cell.font = { size: 10, bold: true, color: { argb: "FF0369A1" } };
          }

          if (colNum === 8 && dr.breakIn !== "—") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
            cell.font = { size: 10, bold: true, color: { argb: "FF0369A1" } };
          }

          if (colNum === 9 && dr.breakLate !== "—") {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
            cell.font = { size: 10, bold: true, color: { argb: "FFB45309" } };
          }

          if (colNum === 10 && dr.late !== "—") {
            cell.font = { size: 10, bold: true, color: { argb: "FFB45309" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
          }

          if (colNum === 11 && dr.earlyOut !== "—") {
            cell.font = { size: 10, bold: true, color: { argb: "FF7C3AED" } };
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F3FF" } };
          }

          if (colNum === 12 || colNum === 13) {
            cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
            if (dr.extraOut !== "—") {
              cell.font = { size: 9, bold: true, color: { argb: "FFC2410C" } };
              cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF1E6" } };
            }
          }
        });


        // ✅ On Leave rows — Check In to Extra In merge panni remark centered ah kaata
        if (dr.status === "On Leave" && !dr.isWeekend) {
          for (let c = 5; c <= 13; c++) row.getCell(c).value = null;
          ws.mergeCells(row.number, 4, row.number, 13);
          const leaveCell = row.getCell(4);
          leaveCell.value = dr.remark && dr.remark.trim() ? dr.remark : "On Leave";
          leaveCell.alignment = { horizontal: "center", vertical: "middle" };
          leaveCell.font = { size: 10, italic: true, color: { argb: "FF0C4A6E" } };
          leaveCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0F2FE" } };
        }

        row.getCell(1).alignment = { horizontal: "left", vertical: "middle" };
      });

      const totalsRow = ws.addRow(["", "", "TOTALS", "", "", "", "", "", "", "", "", "", ""]);
      totalsRow.height = 24;
      totalsRow.getCell(3).value = `P:${presentCount} L:${lateCount} A:${absentCount}`;
      totalsRow.getCell(9).value = totalBreakLate > 0 ? fmtMins(totalBreakLate) : "—";
      totalsRow.getCell(10).value = totalLateIn > 0 ? fmtMins(totalLateIn) : "—";
      totalsRow.getCell(11).value = totalEarlyOut > 0 ? fmtMins(totalEarlyOut) : "—";
      totalsRow.getCell(3).font = { bold: true, size: 10, color: { argb: "FF1F2937" } };
      totalsRow.getCell(3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
      totalsRow.getCell(3).alignment = { horizontal: "center" };
    });

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
