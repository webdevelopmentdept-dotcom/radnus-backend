// jobs/workJobs.js
const cron = require("node-cron");
const Employee = require("../models/Employee");
const Attendance = require("../models/Attendance");
const LeaveRequest = require("../models/LeaveRequest");
const HrHoliday = require("../models/HrHoliday");
const KpiLeaderMapping = require("../models/KpiLeaderMapping");
const Notification = require("../models/Notification");
const WorkTask = require("../models/WorkTask");
const WorkRecurring = require("../models/WorkRecurring");
const DailyWorkReport = require("../models/DailyWorkReport");
const JobLock = require("../models/JobLock");
const { getEffectiveWorkMode } = require("../helpers/workMode");

/* ───────── CONFIG (inga maathunga) ───────── */
const CONFIG = {
  tz: "Asia/Kolkata",
  offDays: ["Sun"], // week off
  schedule: {
    generate: "0 6 * * *",     // 06:00 recurring tasks create
    plan: "30 9 * * *",        // 09:30 plan reminder
    morning: "15 10 * * *",    // 10:15 overdue alert + HR digest
    eod: "30 18 * * *",        // 18:30 EOD reminder
    escalate: "30 19 * * *",   // 19:30 TL / HR escalation
  },
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OPEN = ["pending", "partial"];
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const dayName = (d) => DAYS[new Date(d + "T00:00:00Z").getUTCDay()];
const activeFilter = () => ({
  status: { $in: ["approved", "active"] },
  staffType: { $ne: "machine_staff" },
  exitType: null,
  accessDeactivated: { $ne: true },
});
const shortList = (names, max = 6) =>
  names.slice(0, max).join(", ") + (names.length > max ? ` +${names.length - max} more` : "");

async function isWorkingDay(date) {
  if (CONFIG.offDays.includes(dayName(date))) return false;
  const from = new Date(`${date}T00:00:00+05:30`);
  const to = new Date(`${date}T23:59:59.999+05:30`);
  const h = await HrHoliday.findOne({ date: { $gte: from, $lte: to }, type: { $in: ["public", "company"] } }).lean();
  return !h;
}

// Oru naal ku oru job oru thadava mattum
async function once(key) {
  try { await JobLock.create({ key }); return true; }
  catch (e) { if (e.code === 11000) return false; throw e; }
}

async function onLeaveSet(ids, date) {
  if (!ids.length) return new Set();
  const rows = await LeaveRequest.find({
    employee_id: { $in: ids }, status: "approved",
    from_date: { $lte: date }, to_date: { $gte: date }, is_half_day: { $ne: true },
  }).select("employee_id").lean();
  return new Set(rows.map((r) => String(r.employee_id)));
}

async function notifyMany(list) {
  if (!list.length) return;
  await Notification.insertMany(
    list.map((n) => ({
      recipient_id: n.id,                      // undefined → HR role-wide
      recipient_role: n.role || "employee",
      type: "work_reminder",
      title: n.title,
      message: n.message,
      link: n.link || (n.role === "hr" ? "/hr/dashboard/work-tasks" : "/employee/work-day"),
      isRead: false,
    }))
  );
}

// WFH employees (+ optionally task irukkuravanga), leave la illaadhavanga
async function getTargets(date, { withTasks = false } = {}) {
  const emps = await Employee.find(activeFilter()).select("name workMode wfhFrom wfhTo wfhDays").lean();
  const byId = new Map(emps.map((e) => [String(e._id), e]));
  const ids = new Set(emps.filter((e) => getEffectiveWorkMode(e, date) === "wfh").map((e) => String(e._id)));
  const openCount = new Map();

  if (withTasks) {
    const tasks = await WorkTask.find({
      $or: [{ date, status: { $ne: "cancelled" } }, { date: { $lt: date }, status: { $in: OPEN } }],
    }).select("employee_id status date").lean();
    tasks.forEach((t) => {
      const k = String(t.employee_id);
      if (!byId.has(k)) return;
      if (t.date === date) ids.add(k);
      if (OPEN.includes(t.status)) openCount.set(k, (openCount.get(k) || 0) + 1);
    });
  }

  const arr = [...ids];
  const leave = await onLeaveSet(arr, date);
  return { ids: arr.filter((i) => !leave.has(i)), byId, openCount };
}

/* ───────── 1. Recurring tasks generate ───────── */
async function generateRecurringForDate(date, ruleIds = null, empId = null) {
  if (!(await isWorkingDay(date))) return { created: 0 };

  const q = {
    active: true,
    start_date: { $lte: date },
    $or: [{ end_date: "" }, { end_date: { $gte: date } }],
    days: dayName(date),
  };
  if (ruleIds) q._id = { $in: ruleIds };
  if (empId) q.employee_id = empId;

  const rules = await WorkRecurring.find(q).lean();
  if (!rules.length) return { created: 0 };

  const empIds = [...new Set(rules.map((r) => String(r.employee_id)))];
  const emps = await Employee.find({ ...activeFilter(), _id: { $in: empIds } })
    .select("workMode wfhFrom wfhTo wfhDays").lean();
  const eMap = new Map(emps.map((e) => [String(e._id), e]));
  const leave = await onLeaveSet(empIds, date);

  let created = 0;
  for (const rule of rules) {
    const k = String(rule.employee_id);
    const emp = eMap.get(k);
    if (!emp || leave.has(k)) continue;
    if (rule.only_wfh && getEffectiveWorkMode(emp, date) !== "wfh") continue;

    if (rule.close_previous) {
      await WorkTask.updateMany(
        { rule_id: rule._id, date: { $lt: date }, status: { $in: OPEN } },
        { $set: { status: "cancelled", cancel_reason: "Auto-closed: a new day's target has started", cancelled_by: "System", cancelled_at: new Date() } }
      );
    }

    try {
      await WorkTask.create({
        employee_id: rule.employee_id,
        date,
        title: rule.title,
        description: rule.description,
        priority: rule.priority,
        planned_hours: rule.planned_hours,
        task_type: rule.task_type,
        target_value: rule.target_value,
        unit: rule.unit,
        assigned_by_type: rule.assigned_by_type,
        assigned_by_id: rule.assigned_by_id,
        assigned_by_name: rule.assigned_by_name,
        group_id: rule.group_id,
        source: "recurring",
        rule_id: rule._id,
      });
      created++;
    } catch (e) {
      if (e.code !== 11000) console.error("[workJobs] generate:", e.message); // 11000 = already irukku
    }
  }
  return { created };
}

/* ───────── 2. Plan reminder (09:30) ───────── */
async function planReminder({ date = todayIST(), force = false } = {}) {
  if (!force && !(await isWorkingDay(date))) return { sent: 0 };
  if (!force && !(await once("plan:" + date))) return { sent: 0 };

  const { ids } = await getTargets(date);
  const done = new Set(
    (await DailyWorkReport.find({ date, employee_id: { $in: ids }, plan_submitted_at: { $ne: null } })
      .select("employee_id").lean()).map((r) => String(r.employee_id))
  );
  const todo = ids.filter((i) => !done.has(i));
  await notifyMany(todo.map((id) => ({
    id, title: "Submit your plan",
    message: "You are working from home today. Please submit today's plan.",
  })));
  return { sent: todo.length };
}

/* ───────── 3. Morning: overdue alert + HR digest (10:15) ───────── */
async function morningDigest({ date = todayIST(), force = false } = {}) {
  if (!force && !(await isWorkingDay(date))) return { sent: 0 };
  if (!force && !(await once("morning:" + date))) return { sent: 0 };

  const { ids, byId } = await getTargets(date);
  const name = (i) => byId.get(i)?.name || "Employee";

  const punched = new Set(
    (await Attendance.find({ date, employee_id: { $in: ids } }).select("employee_id punches").lean())
      .filter((a) => (a.punches || []).length > 0).map((a) => String(a.employee_id))
  );
  const planned = new Set(
    (await DailyWorkReport.find({ date, employee_id: { $in: ids }, plan_submitted_at: { $ne: null } })
      .select("employee_id").lean()).map((r) => String(r.employee_id))
  );
  const noPunch = ids.filter((i) => !punched.has(i));
  const noPlan = ids.filter((i) => !planned.has(i));

  // Overdue tasks → employee ku
  const overdue = await WorkTask.find({ due_date: { $gt: "", $lt: date }, status: { $in: OPEN } })
    .select("employee_id title due_date").lean();
  const perEmp = new Map();
  overdue.forEach((t) => {
    const k = String(t.employee_id);
    if (!perEmp.has(k)) perEmp.set(k, []);
    perEmp.get(k).push(t.title);
  });
  const list = [];
  for (const [k, titles] of perEmp) {
    list.push({
      id: k, title: `${titles.length} task overdue`,
      message: `Past due date: ${shortList(titles, 3)}. Please complete them or talk to your HR/TL.`,
    });
  }

  // HR digest (role-wide)
  const waiting = await DailyWorkReport.countDocuments({
    eod_submitted_at: { $ne: null },
    review_status: "pending",
    date: { $lt: date },
  });
  if (ids.length || overdue.length || waiting) {
    const parts = [`WFH today: ${ids.length}`];
    if (noPunch.length) parts.push(` Not punched in: ${noPunch.length} (${shortList(noPunch.map(name), 5)})`);
    if (noPlan.length) parts.push(`Plan not submitted: ${noPlan.length}`);
    if (overdue.length) parts.push(`Overdue tasks: ${overdue.length}`);
    if (waiting) parts.push(`Reports waiting for review: ${waiting}`);
    list.push({ role: "hr", title: "WFH morning summary", message: parts.join(" · ") });
  }
  await notifyMany(list);
  return { sent: list.length };
}

/* ───────── 4. EOD reminder (18:30) ───────── */
async function eodReminder({ date = todayIST(), force = false } = {}) {
  if (!force && !(await isWorkingDay(date))) return { sent: 0 };
  if (!force && !(await once("eod:" + date))) return { sent: 0 };

  const { ids, openCount } = await getTargets(date, { withTasks: true });
  const done = new Set(
    (await DailyWorkReport.find({ date, employee_id: { $in: ids }, eod_submitted_at: { $ne: null } })
      .select("employee_id").lean()).map((r) => String(r.employee_id))
  );
  const todo = ids.filter((i) => !done.has(i));
  await notifyMany(todo.map((id) => ({
    id, title: "Submit your EOD update",
    message: `Please update your work status for today${openCount.get(id) ? ` (${openCount.get(id)} task open)` : ""}.  Mark each task as Pending / Partial / Completed.`,
  })));
  return { sent: todo.length };
}

/* ───────── 5. Escalation (19:30) → TL + HR ───────── */
async function escalate({ date = todayIST(), force = false } = {}) {
  if (!force && !(await isWorkingDay(date))) return { sent: 0 };
  if (!force && !(await once("escalate:" + date))) return { sent: 0 };

  const { ids, byId } = await getTargets(date, { withTasks: true });
  const done = new Set(
    (await DailyWorkReport.find({ date, employee_id: { $in: ids }, eod_submitted_at: { $ne: null } })
      .select("employee_id").lean()).map((r) => String(r.employee_id))
  );
  const missing = ids.filter((i) => !done.has(i));
  if (!missing.length) return { sent: 0 };
  const name = (i) => byId.get(i)?.name || "Employee";
  const missSet = new Set(missing);

  const list = [];
  const maps = await KpiLeaderMapping.find({ isActive: true }).lean();
  for (const m of maps) {
    const mine = (m.member_ids || []).map(String).filter((i) => missSet.has(i));
    if (mine.length) {
      list.push({
        id: String(m.leader_id), title: "Team EOD pending",
        message: `${mine.length} team member(s) have not submitted their EOD update: ${shortList(mine.map(name))}`,
      });
    }
  }
  list.push({
    role: "hr", title: "WFH EOD pending",
    message: `${missing.length} employee(s) have not submitted their EOD: ${shortList(missing.map(name), 8)}`,
  });
  await notifyMany(list);
  return { sent: list.length };
}

/* ───────── Manual run (testing) + cron start ───────── */
const JOBS = {
  generate: (o) => generateRecurringForDate(o.date || todayIST()),
  plan: planReminder,
  morning: morningDigest,
  eod: eodReminder,
  escalate: escalate,
};

async function runNow(job, opts = {}) {
  if (!JOBS[job]) throw new Error("Unknown job. Use: " + Object.keys(JOBS).join(", "));
  return JOBS[job]({ ...opts, force: true });
}

function start() {
  if (process.env.ENABLE_WORK_CRON === "false") {
    console.log("⏸️  Work jobs disabled (ENABLE_WORK_CRON=false)");
    return;
  }
  const opts = { timezone: CONFIG.tz };
  const wrap = (name, fn) => async () => {
    try { console.log(`[workJobs] ${name}:`, JSON.stringify(await fn({}))); }
    catch (e) { console.error(`[workJobs] ${name} failed:`, e.message); }
  };
  Object.entries(CONFIG.schedule).forEach(([name, expr]) => cron.schedule(expr, wrap(name, JOBS[name]), opts));

  // Server late ah start aanaalum innaiku recurring tasks irukkanum
  setTimeout(wrap("generate(startup)", JOBS.generate), 10_000);
  console.log("⏰ Work jobs scheduled (IST)");
}

module.exports = { start, runNow, generateRecurringForDate };