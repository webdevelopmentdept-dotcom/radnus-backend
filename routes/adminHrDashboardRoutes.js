const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth"); 
const adminOnly = require("../middleware/adminOnly"); 

const Employee           = require("../models/Employee");
const Attendance         = require("../models/Attendance");
const LeaveRequest       = require("../models/LeaveRequest");
const Payroll            = require("../models/Payroll");
const Advance            = require("../models/Advance");
const PerformanceReview  = require("../models/PerformanceReview");
const EmployeeAward      = require("../models/EmployeeAward");

// Re-use the SAME logic the HR "Attendance Management" page uses, so that
// dashboard numbers always match that page (status is re-computed from punches,
// employees with no record are counted as absent). Nothing is modified.
const { getDailyReport } = require("../controllers/attendanceController");

const dailyReport = (date) =>
  new Promise((resolve) => {
    const fakeRes = {
      status() { return this; },
      json(payload) { resolve(Array.isArray(payload?.data) ? payload.data : []); return this; },
    };
    Promise.resolve(getDailyReport({ query: { date }, headers: {}, params: {}, body: {} }, fakeRes))
      .catch(() => resolve([]));
  });

// Same buckets as the HR attendance page
const summarizeDay = (rows) => {
  const c = { total: rows.length, onTime: 0, lateStatus: 0, halfDay: 0, onLeave: 0, absent: 0,
              holiday: 0, weekend: 0, lateFlag: 0, missingPunch: 0, earlyOut: 0 };
  rows.forEach((r) => {
    switch (r.status) {
      case "present":  c.onTime++; break;
      case "late":     c.lateStatus++; break;
      case "half_day": c.halfDay++; break;
      case "leave":    c.onLeave++; break;
      case "holiday":  c.holiday++; break;
      case "weekend":  c.weekend++; break;
      default:         c.absent++;
    }
    if ((r.late_minutes || 0) > 0) c.lateFlag++;
    if (r.missing_punch) c.missingPunch++;
    if ((r.early_out_minutes || 0) > 0) c.earlyOut++;
  });
  c.came = c.onTime + c.lateStatus + c.halfDay;   // actually came to work
  return c;
};

const ACTIVE = ["active", "approved"];
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/* ---------- helpers ---------- */
// "YYYY-MM-DD" in Indian time (server may run in UTC)
const istDate = (offsetDays = 0) =>
  new Date(Date.now() + IST_OFFSET_MS + offsetDays * 86400000).toISOString().slice(0, 10);

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch (e) {
    console.error("HR dashboard section error:", e.message);
    return fallback;
  }
}

const monthStart = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), 1);
};

/* ================= GET /api/admin-hr-dashboard/stats ================= */
router.get("/stats", auth, adminOnly, async (req, res) => {
  try {
    const today = istDate(0);
    const last7 = Array.from({ length: 7 }, (_, i) => istDate(-(6 - i)));
    const mStart = monthStart();

    const [
      workforce, departments, joiners, exits,
      attendance, attendanceTrend,
      leave, leaveOnToday, leaveTypes,
      payroll, payrollTrend, advances,
      topPerformers, stars,
    ] = await Promise.all([
      /* ---------- WORKFORCE ---------- */
      safe(async () => {
        const [active, hrms, machine, pendingApproval] = await Promise.all([
          Employee.countDocuments({ status: { $in: ACTIVE } }),
          Employee.countDocuments({ status: { $in: ACTIVE }, staffType: { $ne: "machine_staff" } }),
          Employee.countDocuments({ status: { $in: ACTIVE }, staffType: "machine_staff" }),
          Employee.countDocuments({ status: "admin_pending" }),
        ]);
        const exited = await Employee.countDocuments({
          $or: [{ status: { $in: ["relieved", "fired"] } }, { exitType: { $in: ["relieved", "fired"] } }],
        });
        const attritionPct = active + exited ? Math.round((exited / (active + exited)) * 1000) / 10 : 0;
        return { active, hrms, machine, pendingApproval, exited, attritionPct };
      }, { active: 0, hrms: 0, machine: 0, pendingApproval: 0, exited: 0, attritionPct: 0 }),

      safe(async () => {
        const rows = await Employee.aggregate([
          { $match: { status: { $in: ACTIVE } } },
          { $group: { _id: { $ifNull: ["$department", "Unassigned"] }, count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 10 },
        ]);
        return rows.map((r) => ({ department: r._id || "Unassigned", count: r.count }));
      }, []),

      // NOTE: Employee has no joining-date field, so createdAt is used.
      safe(async () => {
        const filter = { status: { $in: ACTIVE }, createdAt: { $gte: mStart } };
        const [count, list] = await Promise.all([
          Employee.countDocuments(filter),
          Employee.find(filter).sort({ createdAt: -1 }).limit(5).select("name department designation createdAt").lean(),
        ]);
        return { count, list };
      }, { count: 0, list: [] }),

      // NOTE: no exit-date field, so updatedAt is used as the exit time.
      safe(async () => {
        const filter = {
          $or: [{ status: { $in: ["relieved", "fired"] } }, { exitType: { $in: ["relieved", "fired"] } }],
          updatedAt: { $gte: mStart },
        };
        const [count, list] = await Promise.all([
          Employee.countDocuments(filter),
          Employee.find(filter).sort({ updatedAt: -1 }).limit(5).select("name department exitType updatedAt").lean(),
        ]);
        return { count, list };
      }, { count: 0, list: [] }),

      /* ---------- ATTENDANCE (today) – same logic as HR Attendance page ---------- */
      safe(async () => {
        const c = summarizeDay(await dailyReport(today));
        const offDay = c.holiday + c.weekend;
        const isHoliday = c.total > 0 && offDay >= c.total / 2;
        return {
          date: today,
          expected: c.total,
          present: c.came,            // present on time + late + half day
          onTime: c.onTime,
          late: c.lateFlag,           // same as HR page "Late" card
          halfDay: c.halfDay,
          onLeave: c.onLeave,
          absent: c.absent,
          notIn: c.absent,            // kept for the UI ("not in yet / absent")
          missingPunch: c.missingPunch,
          earlyOut: c.earlyOut,
          isHoliday,
          presentPct: c.total ? Math.round((c.came / c.total) * 100) : 0,
        };
      }, { date: today, expected: 0, present: 0, onTime: 0, late: 0, halfDay: 0, onLeave: 0, absent: 0, notIn: 0,
           missingPunch: 0, earlyOut: 0, isHoliday: false, presentPct: 0 }),

      /* ---------- ATTENDANCE trend (last 7 days) ---------- */
      safe(async () => {
        const days = await Promise.all(last7.map(async (date) => ({ date, c: summarizeDay(await dailyReport(date)) })));
        return days.map(({ date, c }) => {
          const isToday = date === today;
          // past day where (almost) nobody came = off day (Sunday / holiday) -> don't count everyone as absent
          const offDay = !isToday && (c.holiday + c.weekend >= c.total / 2 || c.came < c.total * 0.2);
          return {
            date,
            label: new Date(date + "T00:00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric" }),
            Present: c.came,
            Leave: c.onLeave,
            Absent: offDay ? 0 : c.absent,
            offDay,
          };
        });
      }, []),

      /* ---------- LEAVE ---------- */
      safe(async () => {
        const [count, list] = await Promise.all([
          LeaveRequest.countDocuments({ status: "pending" }),
          LeaveRequest.find({ status: "pending" }).sort({ createdAt: 1 }).limit(5)
            .select("employee_name department leave_type from_date to_date current_stage createdAt").lean(),
        ]);
        return { count, list };
      }, { count: 0, list: [] }),

      safe(async () => {
        const filter = { status: "approved", from_date: { $lte: today }, to_date: { $gte: today } };
        const [count, list] = await Promise.all([
          LeaveRequest.countDocuments(filter),
          LeaveRequest.find(filter).limit(8).select("employee_name department leave_type to_date is_half_day").lean(),
        ]);
        return { count, list };
      }, { count: 0, list: [] }),

      safe(async () => {
        const yearStart = `${new Date().getFullYear()}-01-01`;
        const rows = await LeaveRequest.aggregate([
          { $match: { status: "approved", from_date: { $gte: yearStart } } },
          { $group: { _id: "$leave_type", count: { $sum: 1 } } },
          { $sort: { count: -1 } },
          { $limit: 8 },
        ]);
        return rows.map((r) => ({ type: r._id || "Other", count: r.count }));
      }, []),

      /* ---------- PAYROLL ---------- */
      safe(async () => {
        const latest = await Payroll.findOne().sort({ year: -1, month: -1 })
          .select("month year status total_employees total_gross total_deductions total_net_pay approved_at paid_at").lean();
        const draftCount = await Payroll.countDocuments({ status: "draft" });
        const approvedUnpaid = await Payroll.countDocuments({ status: "approved" });
        return { latest, draftCount, approvedUnpaid };
      }, { latest: null, draftCount: 0, approvedUnpaid: 0 }),

      safe(async () => {
        const rows = await Payroll.find().sort({ year: -1, month: -1 }).limit(6)
          .select("month year status total_net_pay total_gross total_employees").lean();
        return rows.reverse();
      }, []),

      safe(async () => {
        const r = await Advance.aggregate([
          { $match: { status: "pending" } },
          { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: "$amount" } } },
        ]);
        return { count: r[0]?.count || 0, amount: r[0]?.amount || 0 };
      }, { count: 0, amount: 0 }),

      /* ---------- TOP PERFORMERS ---------- */
      // Ranked by finalized KPI Performance Review (final_score) in the latest review period
      safe(async () => {
        const latest = await PerformanceReview.findOne({ status: "finalized", final_score: { $ne: null } })
          .sort({ createdAt: -1 }).select("period").lean();
        if (!latest) return { period: null, list: [] };

        const rows = await PerformanceReview.find({ period: latest.period, status: "finalized", final_score: { $ne: null } })
          .sort({ final_score: -1 }).limit(5).select("employee_id final_score rating").lean();

        const emps = await Employee.find({ _id: { $in: rows.map((r) => r.employee_id) } })
          .select("name department designation").lean();
        const map = {};
        emps.forEach((e) => { map[String(e._id)] = e; });

        return {
          period: latest.period,
          list: rows.map((r, i) => ({
            rank: i + 1,
            name: map[String(r.employee_id)]?.name || "Unknown",
            department: map[String(r.employee_id)]?.department || "",
            designation: map[String(r.employee_id)]?.designation || "",
            score: r.final_score,
            rating: r.rating || "",
          })),
        };
      }, { period: null, list: [] }),

      // Recent announced awards (Star of the Month / Spot / Innovation)
      safe(async () => {
        const rows = await EmployeeAward.find({ status: "announced" })
          .sort({ updatedAt: -1 }).limit(5).select("award_type employee_id period category").lean();
        const emps = await Employee.find({ _id: { $in: rows.map((r) => r.employee_id) } })
          .select("name department").lean();
        const map = {};
        emps.forEach((e) => { map[String(e._id)] = e; });
        return rows.map((r) => ({
          type: r.award_type,
          period: r.period || "",
          category: r.category || "",
          name: map[String(r.employee_id)]?.name || "Unknown",
          department: map[String(r.employee_id)]?.department || "",
        }));
      }, []),
    ]);

    res.json({
      success: true,
      generatedAt: new Date(),
      workforce, departments, joiners, exits,
      attendance, attendanceTrend,
      leave, leaveOnToday, leaveTypes,
      payroll, payrollTrend, advances,
      topPerformers, stars,
    });
  } catch (err) {
    console.error("Admin HR dashboard error:", err);
    res.status(500).json({ success: false, message: "Failed to load HR dashboard stats" });
  }
});

module.exports = router;