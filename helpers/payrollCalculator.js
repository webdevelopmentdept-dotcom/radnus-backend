// helpers/payrollCalculator.js
// ── Pure calculation helpers for Payroll ──────────────────────────
// Reads from EXISTING collections (Attendance, LeaveRequest, HrLeaveType,
// HrHoliday, HrShiftSettings) — does NOT modify any of them.
// Attendance.status / work_hours / etc. computation logic is untouched;
// this file only *reads* the already-computed `status` field per day.

const Attendance     = require("../models/Attendance");
const LeaveRequest   = require("../models/LeaveRequest");
const HrLeaveType    = require("../models/HrLeaveType");
const HrHoliday      = require("../models/HrHoliday");
const HrShiftSettings = require("../models/HrShiftSettings");

const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ── Total calendar days in month (per HR's decision: 30/31 base, NOT working-days base) ──
function getTotalDaysInMonth(month, year) {
  return new Date(year, month, 0).getDate(); // month is 1-12
}

function pad2(n) { return String(n).padStart(2, "0"); }

function buildDateList(month, year) {
  const total = getTotalDaysInMonth(month, year);
  const dates = [];
  for (let d = 1; d <= total; d++) {
    dates.push(`${year}-${pad2(month)}-${pad2(d)}`);
  }
  return dates;
}

// ── Figure out which leave types are "paid" (HrLeaveType.paid) ────
async function getPaidLeaveTypeNames() {
  const types = await HrLeaveType.find({ paid: true }).select("name").lean();
  return new Set(types.map((t) => t.name));
}

// ── Get set of holiday date strings ("YYYY-MM-DD") within the month ──
async function getHolidayDatesInMonth(month, year) {
  const start = new Date(year, month - 1, 1);
  const end   = new Date(year, month, 0, 23, 59, 59);
  const holidays = await HrHoliday.find({ date: { $gte: start, $lte: end } }).lean();
  const set = new Set();
  holidays.forEach((h) => {
    const d = new Date(h.date);
    set.add(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`);
  });
  return set;
}

// ── Get set of weekend day-names (from HrShiftSettings.work_days) ─
async function getWeekendDayNames() {
  const settings = await HrShiftSettings.findOne().lean();
  const workDays = settings?.work_days || ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  return new Set(WEEKDAY_NAMES.filter((d) => !workDays.includes(d)));
}

/**
 * Compute attendance summary for one employee for one month.
 * Reads Attendance.status (already computed elsewhere) for every day,
 * and for any day with NO attendance record, infers holiday/weekend/absent.
 */
async function computeAttendanceSummary(employeeId, month, year) {
  const dateList = buildDateList(month, year);
  const totalDays = dateList.length;

  const [records, paidLeaveTypeNames, holidaySet, weekendDayNames] = await Promise.all([
    Attendance.find({
      employee_id: employeeId,
      date: { $in: dateList },
    }).lean(),
    getPaidLeaveTypeNames(),
    getHolidayDatesInMonth(month, year),
    getWeekendDayNames(),
  ]);

  // Approved leave requests overlapping this month — used to check paid/unpaid per date
  const monthStart = dateList[0];
  const monthEnd   = dateList[dateList.length - 1];
  const approvedLeaves = await LeaveRequest.find({
    employee_id: employeeId,
    status: "approved",
    from_date: { $lte: monthEnd },
    to_date:   { $gte: monthStart },
  }).lean();

  // date -> is this leave day paid?
  const leavePaidMap = {};
  approvedLeaves.forEach((lv) => {
    const isPaid = paidLeaveTypeNames.has(lv.leave_type);
    let d = new Date(lv.from_date);
    const to = new Date(lv.to_date);
    while (d <= to) {
      const key = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
      leavePaidMap[key] = isPaid;
      d.setDate(d.getDate() + 1);
    }
  });

  const attendanceByDate = {};
  records.forEach((r) => { attendanceByDate[r.date] = r; });

  let present_days = 0, half_days = 0, paid_leave_days = 0, unpaid_leave_days = 0,
      absent_days = 0, holiday_days = 0, weekend_days = 0, overtime_minutes = 0;

  dateList.forEach((dateStr) => {
    const rec = attendanceByDate[dateStr];
    const dayName = WEEKDAY_NAMES[new Date(dateStr).getDay()];

    if (rec) {
      overtime_minutes += rec.overtime_minutes || 0;
      switch (rec.status) {
        case "present":
        case "late":
          present_days += 1;
          break;
        case "half_day":
          half_days += 1;
          break;
        case "leave":
          if (leavePaidMap[dateStr] === false) unpaid_leave_days += 1;
          else paid_leave_days += 1; // default to paid if not matched (approved leave assumed paid)
          break;
        case "holiday":
          holiday_days += 1;
          break;
        case "weekend":
          weekend_days += 1;
          break;
        case "absent":
        default:
          absent_days += 1;
      }
    } else {
      // No attendance record at all for this date — infer from holiday/weekend config
      if (holidaySet.has(dateStr)) holiday_days += 1;
      else if (weekendDayNames.has(dayName)) weekend_days += 1;
      else if (leavePaidMap[dateStr] !== undefined) {
        if (leavePaidMap[dateStr]) paid_leave_days += 1;
        else unpaid_leave_days += 1;
      } else absent_days += 1; // no record, not holiday/weekend, no approved leave → LOP
    }
  });

  const lop_days = absent_days + unpaid_leave_days;
  const payable_days = present_days + (half_days * 0.5) + paid_leave_days + holiday_days + weekend_days;

  return {
    total_days_in_month: totalDays,
    present_days, half_days, paid_leave_days, unpaid_leave_days,
    absent_days, holiday_days, weekend_days,
    lop_days, payable_days, overtime_minutes,
  };
}

/**
 * Compute salary breakdown for one employee given their attendance summary
 * and EmploymentDetails.salary block.
 *
 * NOTE (per HR confirmation): PF/ESI/TDS process not live yet in the company.
 * Deductions are kept at 0 unless the individual employee has the relevant
 * `*_applicable` flag set AND a rate is configured — until then this always
 * returns 0 for those, so nothing changes for existing employees today.
 */
function computeSalaryBreakdown(salary = {}, attendanceSummary, statutoryRates = {}) {
  const grossMonthly = Number(salary.gross_salary) || 0;
  const totalDays = attendanceSummary.total_days_in_month;
  const perDayRate = totalDays > 0 ? grossMonthly / totalDays : 0;

  const grossEarnings = Math.round(perDayRate * attendanceSummary.payable_days * 100) / 100;

  // Proportional split of basic/hra/allowances by the same payable-day ratio (for payslip display only)
  const ratio = grossMonthly > 0 ? grossEarnings / grossMonthly : 0;
  const earnings = {
    basic:                Math.round((Number(salary.basic) || 0) * ratio * 100) / 100,
    hra:                  Math.round((Number(salary.hra) || 0) * ratio * 100) / 100,
    special_allowance:    Math.round((Number(salary.special_allowance) || 0) * ratio * 100) / 100,
    conveyance_allowance: Math.round((Number(salary.conveyance_allowance) || 0) * ratio * 100) / 100,
    overtime_amount:      0, // OT rate policy not defined yet — kept 0, structure ready
    gross_earnings:        grossEarnings,
  };

  // ── Deductions — 0 by default; only applied if flag=true AND a rate is passed in ──
  const pf  = salary.pf_applicable  && statutoryRates.pf_percent  ? Math.round(grossEarnings * (statutoryRates.pf_percent  / 100) * 100) / 100 : 0;
  const esi = salary.esi_applicable && statutoryRates.esi_percent ? Math.round(grossEarnings * (statutoryRates.esi_percent / 100) * 100) / 100 : 0;
  const tds = salary.tds_applicable && statutoryRates.tds_amount  ? Number(statutoryRates.tds_amount) : 0;
  const professionalTax = Number(salary.professional_tax) || 0; // only if HR already put a value in EmploymentDetails

  const deductions = {
    pf, esi, tds,
    professional_tax: professionalTax,
    lop_deduction: 0, // informational only — LOP already excluded via payable_days
    other: 0,
    total_deductions: Math.round((pf + esi + tds + professionalTax) * 100) / 100,
  };

  const netPay = Math.round((grossEarnings - deductions.total_deductions) * 100) / 100;

  return { perDayRate: Math.round(perDayRate * 100) / 100, earnings, deductions, netPay };
}

module.exports = {
  getTotalDaysInMonth,
  buildDateList,
  computeAttendanceSummary,
  computeSalaryBreakdown,
};