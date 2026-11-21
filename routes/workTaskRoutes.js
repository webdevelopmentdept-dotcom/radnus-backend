const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const auth = require("../middleware/auth");
const Employee = require("../models/Employee");
const KpiLeaderMapping = require("../models/KpiLeaderMapping");
const Notification = require("../models/Notification");
const WorkTask = require("../models/WorkTask");
const DailyWorkReport = require("../models/DailyWorkReport");
const { getEffectiveWorkMode } = require("../helpers/workMode");
const { calcDayScore, recomputeTask } = require("../helpers/workScore");

const PRIORITIES = ["low", "medium", "high"];
const OPEN = ["pending", "partial"];
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const isHr = (req) => ["hr", "admin"].includes(req.user?.role);
const validId = (i) => mongoose.Types.ObjectId.isValid(String(i || ""));
const cleanPriority = (p) => (PRIORITIES.includes(p) ? p : "medium");
const cleanHours = (h) => Math.min(Math.max(Number(h) || 0, 0), 24);

const WorkRecurring = require("../models/WorkRecurring");
const { generateRecurringForDate, runNow } = require("../jobs/workJobs");
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const employeeOnly = (req, res, next) =>
    isHr(req) ? res.status(403).json({ success: false, message: "EMPLOYEE_ONLY" }) : next();

// HR/Admin → ellaarukkum. Employee → Team Leader ah irundha avanga team ku mattum.
async function canAssign(req, res, next) {
    try {
        if (isHr(req)) { req.assignScope = { all: true }; return next(); }
        const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true }).lean();
        if (!m) return res.status(403).json({ success: false, message: "NOT_ALLOWED" });
        req.assignScope = { all: false, members: (m.member_ids || []).map(String) };
        next();
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
}
const inScope = (req, empId) => req.assignScope.all || req.assignScope.members.includes(String(empId));

// Innaiku na: indha naal tasks + munnadi mudiyaadha (pending/partial) tasks. Past date na: antha naal mattum.
const dayQuery = (empId, date, today) =>
    date === today
        ? { employee_id: empId, $or: [{ date }, { date: { $lt: date }, status: { $in: OPEN } }] }
        : { employee_id: empId, date };

// ── Cloudinary upload (optional proof) ───────────────────────
const storage = new CloudinaryStorage({
    cloudinary,
    params: async (req, file) => ({
        folder: "work-proof",
        resource_type: "auto",
        public_id: Date.now() + "-" + file.originalname.replace(/[^\w.\-]/g, "_"),
    }),
});
const ALLOWED = [
    "image/jpeg", "image/png", "image/webp", "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) =>
        ALLOWED.includes(file.mimetype) ? cb(null, true) : cb(new Error("Invalid file type: " + file.mimetype)),
});

// ── Report totals + score refresh ────────────────────────────
async function refreshReport(empId, date, extra = {}) {
    const [tasks, emp] = await Promise.all([
        WorkTask.find({ employee_id: empId, date }).lean(),
        Employee.findById(empId).select("workMode wfhFrom wfhTo wfhDays").lean(),
    ]);
    const s = calcDayScore(tasks, date);
    return DailyWorkReport.findOneAndUpdate(
        { employee_id: empId, date },
        { $set: { work_mode: getEffectiveWorkMode(emp, date), totals: s.totals, score: s.score, ...extra } },
        { upsert: true, new: true }
    );
}
const isLocked = (report) => report && report.review_status === "accepted";

// Task fields validate (self + assign rendukkum)
function buildFields(body, date) {
    const title = String(body.title || "").trim();
    if (!title) return { error: "Title required" };

    const task_type = body.task_type === "target" ? "target" : "normal";
    let target_value = 0, unit = "";
    if (task_type === "target") {
        target_value = Number(body.target_value);
        if (!(target_value > 0) || target_value > 1000000) return { error: "Enter a valid target number" };
        unit = String(body.unit || "").trim().slice(0, 30);
        if (!unit) return { error: "Enter a unit (calls, leads, posts...)" };
    }

    const due_date = body.due_date ? String(body.due_date) : "";
    if (due_date && (!isDate(due_date) || due_date < date))
        return { error: "Due date must be on or after the start date" };

    return {
        fields: {
            title,
            description: String(body.description || "").trim(),
            priority: cleanPriority(body.priority),
            planned_hours: cleanHours(body.planned_hours),
            task_type, target_value, unit, due_date,
        },
    };
}

async function actorName(req) {
    if (isHr(req)) return req.actor?.name || req.user.name || "HR";
    const me = await Employee.findById(req.user.id).select("name").lean();
    return me?.name || "Employee";
}

/* ═════════════ EMPLOYEE SIDE ═════════════ */

router.get("/my", auth, employeeOnly, async (req, res) => {
    try {
        const date = isDate(req.query.date) ? req.query.date : todayIST();
        const today = todayIST();
        if (date === today) await generateRecurringForDate(today, null, req.user.id);
        const [tasks, report] = await Promise.all([
            WorkTask.find(dayQuery(req.user.id, date, today)).sort({ date: 1, createdAt: 1 }).lean(),
            DailyWorkReport.findOne({ employee_id: req.user.id, date }).lean(),
        ]);
        res.json({ success: true, date, today, data: { tasks, report } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Self task add
router.post("/tasks", auth, employeeOnly, async (req, res) => {
    try {
        const date = isDate(req.body.date) ? req.body.date : todayIST();
        if (date < todayIST()) return res.status(400).json({ success: false, message: "Cannot add a task for a past date" });

        const v = buildFields(req.body, date);
        if (v.error) return res.status(400).json({ success: false, message: v.error });

        const existing = await DailyWorkReport.findOne({ employee_id: req.user.id, date }).lean();
        if (isLocked(existing)) return res.status(403).json({ success: false, message: "Report is already accepted and locked" });

        const task = await WorkTask.create({
            ...v.fields,
            employee_id: req.user.id,
            date,
            assigned_by_type: "self",
            assigned_by_id: String(req.user.id),
            assigned_by_name: await actorName(req),
        });
        await refreshReport(req.user.id, date);
        res.status(201).json({ success: true, data: task });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Employee: date range la ennoda naal-vaari history (max 62 naal)
router.get("/my/history", auth, employeeOnly, async (req, res) => {
    try {
        const today = todayIST();
        const DAY = 86400000;
        const shift = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * DAY).toISOString().slice(0, 10);

        let to = isDate(req.query.to) ? req.query.to : today;
        if (to > today) to = today;
        let from = isDate(req.query.from) ? req.query.from : shift(to, -6);
        if (from < shift(to, -61)) from = shift(to, -61);
        if (from > to) from = to;

        const range = { $gte: from, $lte: to };
        const [tasks, reports] = await Promise.all([
            WorkTask.find({ employee_id: req.user.id, date: range }).select("date status").lean(),
            DailyWorkReport.find({ employee_id: req.user.id, date: range }).lean(),
        ]);

        const map = new Map();
        const row = (d) => {
            if (!map.has(d)) map.set(d, {
                date: d, total: 0, done: 0, partial: 0, pending: 0, cancelled: 0,
                plan: false, eod: false, eod_late: false, score: null,
                review_status: "pending", review_note: "", reviewer_name: "", summary: "", work_mode: "",
            });
            return map.get(d);
        };
        tasks.forEach((t) => {
            const r = row(t.date);
            if (t.status === "cancelled") r.cancelled++;
            else {
                r.total++;
                if (t.status === "completed") r.done++;
                else if (t.status === "partial") r.partial++;
                else r.pending++;
            }
        });
        reports.forEach((rp) => {
            const r = row(rp.date);
            r.plan = !!rp.plan_submitted_at;
            r.eod = !!rp.eod_submitted_at;
            r.eod_late = !!rp.eod_late;
            r.score = rp.score ?? null;
            r.review_status = rp.review_status || "pending";
            r.review_note = rp.review_note || "";
            r.reviewer_name = rp.reviewer_name || "";
            r.summary = rp.summary || "";
            r.work_mode = rp.work_mode || "";
        });

        const data = [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
        res.json({ success: true, from, to, data });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Self task, progress illa na delete
router.delete("/tasks/:id", auth, employeeOnly, async (req, res) => {
    try {
        const task = await WorkTask.findOne({ _id: req.params.id, employee_id: req.user.id });
        if (!task) return res.status(404).json({ success: false, message: "Not found" });
        if (task.assigned_by_type !== "self")
            return res.status(403).json({ success: false, message: "Assigned tasks cannot be deleted" });
        if ((task.progress_log || []).length)
            return res.status(400).json({ success: false, message: "This task has progress. Close it instead of deleting" });

        const report = await DailyWorkReport.findOne({ employee_id: req.user.id, date: task.date }).lean();
        if (isLocked(report)) return res.status(403).json({ success: false, message: "Locked" });

        await task.deleteOne();
        await refreshReport(req.user.id, task.date);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Task close/cancel (employee → own self task, HR → any, TL → team)
router.post("/tasks/:id/close", auth, async (req, res) => {
    try {
        const reason = String(req.body.reason || "").trim().slice(0, 500);
        if (!reason) return res.status(400).json({ success: false, message: "Please provide a reason" });

        const task = await WorkTask.findById(req.params.id);
        if (!task) return res.status(404).json({ success: false, message: "Not found" });

        if (!isHr(req)) {
            if (String(task.employee_id) === String(req.user.id)) {
                if (task.assigned_by_type !== "self")
                    return res.status(403).json({ success: false, message: "Only HR or the Team Leader can close an assigned task" });
            } else {
                const m = await KpiLeaderMapping.findOne({ leader_id: req.user.id, isActive: true }).lean();
                if (!m || !(m.member_ids || []).map(String).includes(String(task.employee_id)))
                    return res.status(403).json({ success: false, message: "NOT_YOUR_TEAM" });
            }
        }
        if (["completed", "cancelled"].includes(task.status))
            return res.status(400).json({ success: false, message: "Already " + task.status });

        task.status = "cancelled";
        task.cancel_reason = reason;
        task.cancelled_by = await actorName(req);
        task.cancelled_at = new Date();
        await task.save();
        await refreshReport(task.employee_id, task.date);
        res.json({ success: true, data: task });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Optional proof upload (max 3 per task, 5MB each)
router.post("/tasks/:id/attachment", auth, employeeOnly, (req, res) => {
    upload.single("file")(req, res, async (err) => {
        if (err) return res.status(400).json({ success: false, message: err.message });
        try {
            if (!req.file) return res.status(400).json({ success: false, message: "File missing" });
            const task = await WorkTask.findOne({ _id: req.params.id, employee_id: req.user.id });
            if (!task) return res.status(404).json({ success: false, message: "Task not found" });
            if ((task.attachments || []).length >= 3)
                return res.status(400).json({ success: false, message: "Max 3 files per task" });

            const report = await DailyWorkReport.findOne({ employee_id: req.user.id, date: task.date }).lean();
            if (isLocked(report)) return res.status(403).json({ success: false, message: "Locked" });

            task.attachments.push({ url: req.file.path, name: req.file.originalname, mime: req.file.mimetype });
            await task.save();
            res.json({ success: true, data: task });
        } catch (e) {
            res.status(500).json({ success: false, message: e.message });
        }
    });
});

router.delete("/tasks/:id/attachment/:attId", auth, employeeOnly, async (req, res) => {
    try {
        const task = await WorkTask.findOne({ _id: req.params.id, employee_id: req.user.id });
        if (!task) return res.status(404).json({ success: false, message: "Not found" });
        const report = await DailyWorkReport.findOne({ employee_id: req.user.id, date: task.date }).lean();
        if (isLocked(report)) return res.status(403).json({ success: false, message: "Locked" });
        task.attachments = task.attachments.filter((a) => String(a._id) !== req.params.attId);
        await task.save();
        res.json({ success: true, data: task });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Morning: "Plan submit"
router.post("/plan/submit", auth, employeeOnly, async (req, res) => {
    try {
        const date = isDate(req.body.date) ? req.body.date : todayIST();
        const count = await WorkTask.countDocuments(dayQuery(req.user.id, date, todayIST()));
        if (!count) return res.status(400).json({ success: false, message: "Add at least one task first" });

        const existing = await DailyWorkReport.findOne({ employee_id: req.user.id, date }).lean();
        const extra = existing?.plan_submitted_at ? {} : { plan_submitted_at: new Date() };
        const report = await refreshReport(req.user.id, date, extra);
        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Evening: EOD update
// body: { date, summary, items: [ {id, status, percent, note}  (normal)
//                               | {id, value_today, note}      (target) ] }
router.post("/eod", auth, employeeOnly, async (req, res) => {
    try {
        const empId = req.user.id;
        const today = todayIST();
        const date = isDate(req.body.date) ? req.body.date : today;
        if (date > today) return res.status(400).json({ success: false, message: "Cannot submit EOD for a future date" });

        const items = Array.isArray(req.body.items) ? req.body.items : [];
        const summary = String(req.body.summary || "").trim().slice(0, 2000);

        const existing = await DailyWorkReport.findOne({ employee_id: empId, date }).lean();
        if (isLocked(existing)) return res.status(403).json({ success: false, message: "Report accepted aagiduchu, locked" });

        const tasks = await WorkTask.find(dayQuery(empId, date, today));
        if (!tasks.length) return res.status(400).json({ success: false, message: "No tasks for this day" });
        const byId = new Map(tasks.map((t) => [String(t._id), t]));

        // Pass 1: validate
        const prepared = [];
        for (const it of items) {
            const t = byId.get(String(it.id));
            if (!t || t.status === "cancelled") continue;
            const note = String(it.note || "").trim().slice(0, 1000);

            if (t.task_type === "target") {
                const v = Number(it.value_today === "" || it.value_today == null ? 0 : it.value_today);
                if (!(v >= 0) || v > 1000000)
                    return res.status(400).json({ success: false, message: `"${t.title}":  enter a valid number` });
                prepared.push({ t, kind: "target", value: v, note });
            } else {
                if (!["pending", "partial", "completed"].includes(it.status))
                    return res.status(400).json({ success: false, message: `"${t.title}": invalid status` });

                const prev = (t.progress_log || []).filter((l) => l.date < date)
                    .sort((a, b) => a.date.localeCompare(b.date)).pop();
                let pct = 0;
                if (it.status === "completed") pct = 100;
                if (it.status === "pending") pct = prev?.percent || 0;
                if (it.status === "partial") {
                    pct = Math.round(Number(it.percent));
                    if (!(pct >= 1 && pct <= 99))
                        return res.status(400).json({ success: false, message: `"${t.title}": enter 1-99 % for partial` });
                    if (!note)
                        return res.status(400).json({ success: false, message: `"${t.title}": a reason/note is required for partial` });
                }
                prepared.push({ t, kind: "normal", status: it.status, pct, note });
            }
        }

        // Pass 2: save (antha naal entry replace aagum, so thirumba update pannalam)
        const now = new Date();
        for (const p of prepared) {
            const t = p.t;
            t.progress_log = (t.progress_log || []).filter((l) => l.date !== date);
            if (p.kind === "target") {
                t.progress_log.push({ date, value_today: p.value, note: p.note, at: now });
            } else {
                t.progress_log.push({ date, status: p.status, percent: p.pct, value_today: 0, note: p.note, at: now });
            }
            recomputeTask(t);
            t.note = p.note;
            await t.save();
        }

        const report = await refreshReport(empId, date, {
            summary,
            eod_updated_at: now,
            eod_submitted_at: existing?.eod_submitted_at || now,
            eod_late: existing?.eod_submitted_at ? !!existing.eod_late : date < today,
            review_status: "pending",
        });

                try {
            const [emp, leaderMaps] = await Promise.all([
                Employee.findById(empId).select("name").lean(),
                KpiLeaderMapping.find({ isActive: true, member_ids: empId }).select("leader_id").lean(),
            ]);
            const wasSubmitted = !!existing?.eod_submitted_at;
            const title = wasSubmitted ? "EOD report updated" : "EOD report submitted";
            const message = `${emp?.name || "An employee"} ${wasSubmitted ? "updated" : "submitted"} the EOD report for ${date}. Review pending.`;

            const docs = [
                // HR-ku eppavume (TL irundhaalum)
                { recipient_role: "hr", type: "work_task", title, message, link: "/hr/dashboard/work-tasks", isRead: false },
                // TL-ku (irundha)
                ...leaderMaps.map((m) => ({
                    recipient_id: String(m.leader_id),
                    recipient_role: "employee",
                    type: "work_task",
                    title,
                    message,
                    link: "/employee/team-tasks",
                    isRead: false,
                })),
            ];
            await Notification.insertMany(docs);
        } catch (err) {
            console.error("EOD notification failed:", err.message);
        }

        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/* ═════════════ HR / TEAM LEADER SIDE ═════════════ */

const baseEmpFilter = () => ({
    status: { $in: ["approved", "active"] },
    staffType: { $ne: "machine_staff" },
    exitType: null,
    accessDeactivated: { $ne: true },
});
const EMP_FIELDS = "name employeeId department designation workMode wfhFrom wfhTo wfhDays";

router.get("/assignable", auth, canAssign, async (req, res) => {
    try {
        const filter = baseEmpFilter();
        if (!req.assignScope.all) filter._id = { $in: req.assignScope.members };
        const today = todayIST();
        const rows = await Employee.find(filter).select(EMP_FIELDS).sort({ name: 1 }).lean();
        res.json({ success: true, data: rows.map((e) => ({ ...e, effectiveToday: getEffectiveWorkMode(e, today) })) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Teams list (HR ku "Team" option ku)
router.get("/teams", auth, canAssign, async (req, res) => {
    try {
        if (!req.assignScope.all) return res.json({ success: true, data: [] });
        const maps = await KpiLeaderMapping.find({ isActive: true }).populate("leader_id", "name employeeId").lean();
        res.json({
            success: true,
            data: maps
                .filter((m) => m.leader_id)
                .map((m) => ({
                    leader_id: m.leader_id._id,
                    leader_name: m.leader_id.name,
                    members: (m.member_ids || []).length,
                })),
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Target → employee list resolve
async function resolveTargets(req, t, date) {
    const scope = req.assignScope;
    const base = baseEmpFilter();
    if (!scope.all) base._id = { $in: scope.members };
    const type = t?.type || "employees";

    if (type === "employees") {
        const ids = [...new Set((t.employee_ids || []).map(String))].filter(validId);
        if (!ids.length) return { error: "Select at least one employee" };
        if (!scope.all && ids.some((i) => !scope.members.includes(i)))
            return { error: "One or more selected employees are not in your team", code: 403 };
        base._id = { $in: ids };
    } else if (type === "department") {
        if (!t.department) return { error: "Select a department" };
        base.department = t.department;
    } else if (type === "team") {
        const leaderId = scope.all ? t.leader_id : req.user.id;
        if (!validId(leaderId)) return { error: "Select a team" };
        const m = await KpiLeaderMapping.findOne({ leader_id: leaderId, isActive: true }).lean();
        if (!m) return { error: "Team not found" };
        base._id = { $in: (m.member_ids || []).map(String) };
    } else if (type === "all_wfh" || type === "all") {
        // base filter podhum
    } else {
        return { error: "Invalid target" };
    }

    let rows = await Employee.find(base).select("name workMode wfhFrom wfhTo wfhDays").lean();
    if (type === "all_wfh") rows = rows.filter((e) => getEffectiveWorkMode(e, date) === "wfh");
    if (!rows.length) return { error: "No matching employees found" };
    if (rows.length > 300) return { error: "Maximum 300 employees at a time" };
    return { rows };
}

// Assign
// body: { target, date, due_date, title, ..., repeat?: { enabled, days[], end_date, only_wfh, close_previous } }
router.post("/assign", auth, canAssign, async (req, res) => {
    try {
        const date = isDate(req.body.date) ? req.body.date : todayIST();
        if (date < todayIST()) return res.status(400).json({ success: false, message: "Cannot assign for a past date" });

        const v = buildFields(req.body, date);
        if (v.error) return res.status(400).json({ success: false, message: v.error });

        // Repeat (dhinam) options
        let repeat = null;
        const rp = req.body.repeat;
        if (rp && rp.enabled) {
            const days = Array.isArray(rp.days) && rp.days.length ? rp.days : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
            if (days.some((d) => !DAYS.includes(d)))
                return res.status(400).json({ success: false, message: "Invalid repeat days" });
            const end_date = rp.end_date ? String(rp.end_date) : "";
            if (end_date && (!isDate(end_date) || end_date < date))
                return res.status(400).json({ success: false, message: "Repeat end date must be on or after the start date" });
            repeat = { days, end_date, only_wfh: !!rp.only_wfh, close_previous: !!rp.close_previous };
        }

        const r = await resolveTargets(req, req.body.target, date);
        if (r.error) return res.status(r.code || 400).json({ success: false, message: r.error });

        const byType = isHr(req) ? "hr" : "tl";
        const byId = String(req.actor?.id || req.user.id || "");
        const byName = await actorName(req);
        const groupId = String(new mongoose.Types.ObjectId());
        const f = v.fields;

        if (repeat) {
            const rules = await WorkRecurring.insertMany(
                r.rows.map((e) => ({
                    ...f, due_date: undefined,
                    employee_id: e._id,
                    start_date: date,
                    ...repeat,
                    assigned_by_type: byType, assigned_by_id: byId, assigned_by_name: byName,
                    group_id: groupId,
                }))
            );
            await generateRecurringForDate(date, rules.map((x) => x._id)); // start naal task ippave create
        } else {
            await WorkTask.insertMany(
                r.rows.map((e) => ({
                    ...f,
                    employee_id: e._id,
                    date,
                    assigned_by_type: byType, assigned_by_id: byId, assigned_by_name: byName,
                    group_id: groupId,
                }))
            );
            for (const e of r.rows) await refreshReport(e._id, date);
        }

        const msg =
            `${byName} assigned you "${f.title}"` +
            (f.task_type === "target" ? ` (${f.target_value} ${f.unit})` : "") +
            (repeat ? ` as a daily task (from ${date}${repeat.end_date ? " to " + repeat.end_date : ""}).`
                : ` (${date}${f.due_date ? ", due " + f.due_date : ""}).`);

        await Notification.insertMany(
            r.rows.map((e) => ({
                recipient_id: String(e._id), recipient_role: "employee",
                type: "work_task", title: repeat ? "Daily target assigned" : "New task assigned",
                message: msg, link: "/employee/work-day",
            }))
        );

        res.status(201).json({ success: true, count: r.rows.length, group_id: groupId, repeat: !!repeat });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Recurring rules list
router.get("/recurring", auth, canAssign, async (req, res) => {
    try {
        const filter = { active: true };
        if (!req.assignScope.all) filter.employee_id = { $in: req.assignScope.members };
        const rules = await WorkRecurring.find(filter)
            .populate("employee_id", "name department").sort({ createdAt: -1 }).lean();
        res.json({ success: true, data: rules.filter((r) => r.employee_id) });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Oru group (oru assign batch) motha stop
router.put("/recurring/group/:groupId/stop", auth, canAssign, async (req, res) => {
    try {
        const q = { group_id: req.params.groupId, active: true };
        if (!req.assignScope.all) q.employee_id = { $in: req.assignScope.members };
        const r = await WorkRecurring.updateMany(q, {
            $set: { active: false, stopped_by: await actorName(req), stopped_at: new Date() },
        });
        res.json({ success: true, stopped: r.modifiedCount });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Testing: jobs ah ippave run pannu (HR only)
// body: { job: "generate|plan|morning|eod|escalate", date?: "YYYY-MM-DD" }
router.post("/jobs/run", auth, async (req, res) => {
    try {
        if (!isHr(req)) return res.status(403).json({ success: false, message: "HR_ONLY" });
        const out = await runNow(String(req.body.job || ""), { date: isDate(req.body.date) ? req.body.date : undefined });
        res.json({ success: true, result: out });
    } catch (e) {
        res.status(400).json({ success: false, message: e.message });
    }
});

// Day overview (HR: ellaarum, TL: team) — self vs assigned count kooda
router.get("/overview", auth, canAssign, async (req, res) => {
    try {
        const date = isDate(req.query.date) ? req.query.date : todayIST();
        const filter = baseEmpFilter();
        if (!req.assignScope.all) filter._id = { $in: req.assignScope.members };
        if (req.query.department) filter.department = req.query.department;

        let emps = await Employee.find(filter).select(EMP_FIELDS).sort({ name: 1 }).lean();
        emps = emps.map((e) => ({ ...e, effectiveToday: getEffectiveWorkMode(e, date) }));
        if (req.query.wfh === "1") emps = emps.filter((e) => e.effectiveToday === "wfh");

        const ids = emps.map((e) => e._id);
        const [tasks, reports, carried] = await Promise.all([
            WorkTask.find({ employee_id: { $in: ids }, date }).select("employee_id assigned_by_type status").lean(),
            DailyWorkReport.find({ employee_id: { $in: ids }, date }).lean(),
            WorkTask.find({ employee_id: { $in: ids }, date: { $lt: date }, status: { $in: OPEN } })
                .select("employee_id due_date").lean(),
        ]);

        const tMap = new Map(), cMap = new Map(), rMap = new Map();
        tasks.forEach((t) => {
            const k = String(t.employee_id);
            if (!tMap.has(k)) tMap.set(k, []);
            tMap.get(k).push(t);
        });
        carried.forEach((t) => {
            const k = String(t.employee_id);
            const c = cMap.get(k) || { open: 0, overdue: 0 };
            c.open++;
            if (t.due_date && t.due_date < date) c.overdue++;
            cMap.set(k, c);
        });
        reports.forEach((r) => rMap.set(String(r.employee_id), r));

        const data = emps.map((e) => {
            const k = String(e._id);
            const ts = (tMap.get(k) || []).filter((t) => t.status !== "cancelled");
            const rep = rMap.get(k);
            const c = cMap.get(k) || { open: 0, overdue: 0 };
            return {
                ...e,
                total: ts.length,
                self: ts.filter((t) => t.assigned_by_type === "self").length,
                assigned: ts.filter((t) => t.assigned_by_type !== "self").length,
                completed: ts.filter((t) => t.status === "completed").length,
                carried: c.open,
                overdue: c.overdue,
                plan: !!rep?.plan_submitted_at,
                eod: !!rep?.eod_submitted_at,
                eod_late: !!rep?.eod_late,
                score: rep?.score ?? null,
                review_status: rep?.review_status || "pending",
            };
        });
        res.json({ success: true, date, data });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Oru employee oda naal
router.get("/by-employee/:employeeId", auth, canAssign, async (req, res) => {
    try {
        const { employeeId } = req.params;
        if (!validId(employeeId)) return res.status(400).json({ success: false, message: "Invalid id" });
        if (!inScope(req, employeeId)) return res.status(403).json({ success: false, message: "NOT_YOUR_TEAM" });

        const date = isDate(req.query.date) ? req.query.date : todayIST();
        const [tasks, report] = await Promise.all([
            WorkTask.find(dayQuery(employeeId, date, todayIST())).sort({ date: 1, createdAt: 1 }).lean(),
            DailyWorkReport.findOne({ employee_id: employeeId, date }).lean(),
        ]);
        res.json({ success: true, date, data: { tasks, report } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});


const ExcelJS = require("exceljs");

const shiftDate = (d, n) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 86400000).toISOString().slice(0, 10);

const parseRange = (q) => {
    const to = isDate(q.to) ? q.to : todayIST();
    let from = isDate(q.from) ? q.from : shiftDate(to, -6);
    if (from > to) from = to;
    const earliest = shiftDate(to, -30);
    if (from < earliest) from = earliest;
    return { from, to };
};

const fmtTime = (d) => (d ? new Date(new Date(d).getTime() + 5.5 * 3600 * 1000).toISOString().slice(11, 16) : "");

const groupBy = (list) => {
    const m = new Map();
    list.forEach((x) => {
        const k = String(x.employee_id);
        if (!m.has(k)) m.set(k, []);
        m.get(k).push(x);
    });
    return m;
};

const avg = (nums) => (nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

async function loadRange(req) {
    const { from, to } = parseRange(req.query);
    const filter = baseEmpFilter();
    if (!req.assignScope.all) filter._id = { $in: req.assignScope.members };
    if (req.query.department) filter.department = String(req.query.department);

    let emps = await Employee.find(filter).select(EMP_FIELDS).sort({ name: 1 }).lean();
    const ids = emps.map((e) => e._id);

    const [reports, tasks, overdue] = await Promise.all([
        DailyWorkReport.find({ employee_id: { $in: ids }, date: { $gte: from, $lte: to } }).lean(),
        WorkTask.find({ employee_id: { $in: ids }, date: { $gte: from, $lte: to }, status: { $ne: "cancelled" } })
            .select("employee_id date title task_type priority target_value achieved_value unit status percent due_date assigned_by_type assigned_by_name source note")
            .lean(),
        WorkTask.find({ employee_id: { $in: ids }, status: { $in: OPEN }, due_date: { $gt: "", $lt: todayIST() } })
            .select("employee_id")
            .lean(),
    ]);

    let repList = reports;
    let taskList = tasks;
    if (req.query.wfh === "1") {
        const wfhIds = new Set(reports.filter((r) => r.work_mode === "wfh").map((r) => String(r.employee_id)));
        emps = emps.filter((e) => wfhIds.has(String(e._id)));
        repList = reports.filter((r) => wfhIds.has(String(r.employee_id)));
        taskList = tasks.filter((t) => wfhIds.has(String(t.employee_id)));
    }
    return { from, to, emps, reports: repList, tasks: taskList, overdue };
}

function buildRows({ emps, reports, tasks, overdue }) {
    const repMap = groupBy(reports);
    const taskMap = groupBy(tasks);
    const overdueMap = groupBy(overdue);
    return emps.map((e) => {
        const k = String(e._id);
        const reps = repMap.get(k) || [];
        const ts = taskMap.get(k) || [];
        return {
            _id: e._id,
            name: e.name,
            employeeId: e.employeeId,
            department: e.department || "",
            designation: e.designation || "",
            days: reps.length,
            wfhDays: reps.filter((r) => r.work_mode === "wfh").length,
            planDays: reps.filter((r) => r.plan_submitted_at).length,
            eodDays: reps.filter((r) => r.eod_submitted_at).length,
            avgScore: avg(reps.filter((r) => r.score != null).map((r) => r.score)),
            tasks: ts.length,
            completed: ts.filter((t) => t.status === "completed").length,
            accepted: reps.filter((r) => r.review_status === "accepted").length,
            rework: reps.filter((r) => r.review_status === "rework").length,
            overdue: (overdueMap.get(k) || []).length,
        };
    });
}

router.put("/review/:employeeId", auth, canAssign, async (req, res) => {
    try {
        const { employeeId } = req.params;
        if (!validId(employeeId)) return res.status(400).json({ success: false, message: "Invalid id" });
        if (!inScope(req, employeeId)) return res.status(403).json({ success: false, message: "NOT_YOUR_TEAM" });

        const date = isDate(req.body.date) ? req.body.date : todayIST();
        const status = req.body.status;
        if (!["accepted", "rework", "pending"].includes(status))
            return res.status(400).json({ success: false, message: "Invalid review status" });

        const note = String(req.body.note || "").trim().slice(0, 1000);
        if (status === "rework" && !note)
            return res.status(400).json({ success: false, message: "A note is required when requesting rework" });

        const report = await DailyWorkReport.findOne({ employee_id: employeeId, date });
        if (!report || !report.eod_submitted_at)
            return res.status(400).json({ success: false, message: "The EOD report has not been submitted yet" });

        const reviewer = await actorName(req);
        report.review_status = status;
        report.review_note = status === "pending" ? "" : note;
        report.reviewer_name = status === "pending" ? "" : reviewer;
        report.reviewed_at = status === "pending" ? null : new Date();
        await report.save();

        if (status !== "pending") {
            await Notification.insertMany([
                {
                    recipient_id: String(employeeId),
                    recipient_role: "employee",
                    type: "work_task",
                    title: status === "accepted" ? "EOD report accepted" : "EOD report needs rework",
                    message:
                        `${reviewer} ${status === "accepted" ? "accepted" : "requested rework on"} your report for ${date}.` +
                        (note ? ` Note: ${note}` : ""),
                    link: "/employee/work-day",
                },
            ]);
        }
        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get("/summary", auth, canAssign, async (req, res) => {
    try {
        const data = await loadRange(req);
        const rows = buildRows(data);

        const byDate = new Map();
        data.reports.forEach((r) => {
            const d = byDate.get(r.date) || { scores: [], eod: 0, total: 0 };
            if (r.score != null) d.scores.push(r.score);
            if (r.eod_submitted_at) d.eod++;
            d.total++;
            byDate.set(r.date, d);
        });

        const trend = [];
        for (let d = data.from; d <= data.to; d = shiftDate(d, 1)) {
            const v = byDate.get(d);
            trend.push({ date: d, avgScore: v ? avg(v.scores) : null, eod: v ? v.eod : 0, total: v ? v.total : 0 });
        }

        const eodCount = data.reports.filter((r) => r.eod_submitted_at).length;
        res.json({
            success: true,
            from: data.from,
            to: data.to,
            cards: {
                employees: rows.filter((r) => r.days > 0).length,
                reports: data.reports.length,
                eodRate: data.reports.length ? Math.round((eodCount / data.reports.length) * 100) : 0,
                avgScore: avg(data.reports.filter((r) => r.score != null).map((r) => r.score)),
                rework: data.reports.filter((r) => r.review_status === "rework").length,
            },
            rows,
            trend,
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

router.get("/export", auth, canAssign, async (req, res) => {
    try {
        const data = await loadRange(req);
        const rows = buildRows(data);
        const empMap = new Map(data.emps.map((e) => [String(e._id), e]));
        const nameOf = (id) => empMap.get(String(id))?.name || "";

        const wb = new ExcelJS.Workbook();
        const addSheet = (name, columns, items) => {
            const ws = wb.addWorksheet(name);
            ws.columns = columns.map(([header, key, width]) => ({ header, key, width }));
            ws.getRow(1).font = { bold: true };
            ws.views = [{ state: "frozen", ySplit: 1 }];
            items.forEach((i) => ws.addRow(i));
        };

        addSheet(
            "Summary",
            [
                ["Employee", "name", 24], ["Employee ID", "employeeId", 14], ["Department", "department", 18],
                ["Days Reported", "days", 14], ["WFH Days", "wfhDays", 10], ["Plans Submitted", "planDays", 15],
                ["EODs Submitted", "eodDays", 15], ["Average Score %", "avgScore", 15], ["Tasks", "tasks", 8],
                ["Completed", "completed", 11], ["Accepted", "accepted", 10], ["Rework", "rework", 9], ["Overdue Now", "overdue", 12],
            ],
            rows
        );

        const daily = [...data.reports]
            .sort((a, b) => a.date.localeCompare(b.date) || nameOf(a.employee_id).localeCompare(nameOf(b.employee_id)))
            .map((r) => {
                const e = empMap.get(String(r.employee_id)) || {};
                return {
                    date: r.date, name: e.name || "", employeeId: e.employeeId || "", department: e.department || "",
                    mode: r.work_mode === "wfh" ? "WFH" : "Office",
                    total: r.totals?.total || 0, completed: r.totals?.completed || 0, partial: r.totals?.partial || 0,
                    pending: r.totals?.pending || 0, score: r.score ?? "",
                    plan: fmtTime(r.plan_submitted_at), eod: fmtTime(r.eod_submitted_at),
                    eodDate: r.eod_submitted_at ? new Date(new Date(r.eod_submitted_at).getTime() + 5.5 * 3600 * 1000).toISOString().slice(0, 10) : "",
                    late: r.eod_late ? "Late" : "",
                    review: r.review_status, reviewer: r.reviewer_name || "", reviewNote: r.review_note || "", summary: r.summary || "",
                };
            });
        addSheet(
            "Daily Report",
            [
                ["Date", "date", 12], ["Employee", "name", 24], ["Employee ID", "employeeId", 14], ["Department", "department", 18],
                ["Mode", "mode", 9], ["Tasks", "total", 8], ["Completed", "completed", 11], ["Partial", "partial", 9],
                ["Pending", "pending", 9], ["Score %", "score", 9], ["Plan Submitted", "plan", 14], ["EOD Submitted", "eod", 14], ["EOD Date", "eodDate", 12], ["Late?", "late", 8],
                ["Review", "review", 11], ["Reviewer", "reviewer", 18], ["Review Note", "reviewNote", 28], ["Summary", "summary", 40],
            ],
            daily
        );

        const taskRows = [...data.tasks]
            .sort((a, b) => a.date.localeCompare(b.date) || nameOf(a.employee_id).localeCompare(nameOf(b.employee_id)))
            .map((t) => {
                const e = empMap.get(String(t.employee_id)) || {};
                return {
                    date: t.date, name: e.name || "", employeeId: e.employeeId || "", title: t.title,
                    type: t.task_type, priority: t.priority,
                    target: t.task_type === "target" ? t.target_value : "", achieved: t.task_type === "target" ? t.achieved_value : "",
                    unit: t.unit || "", status: t.status, percent: t.percent, due: t.due_date || "",
                    assignedBy: t.assigned_by_type === "self" ? "Self" : t.assigned_by_name, source: t.source, note: t.note || "",
                };
            });
        addSheet(
            "Tasks",
            [
                ["Date", "date", 12], ["Employee", "name", 24], ["Employee ID", "employeeId", 14], ["Task", "title", 34],
                ["Type", "type", 9], ["Priority", "priority", 9], ["Target", "target", 9], ["Achieved", "achieved", 10],
                ["Unit", "unit", 10], ["Status", "status", 11], ["Percent", "percent", 9], ["Due Date", "due", 12],
                ["Assigned By", "assignedBy", 18], ["Source", "source", 11], ["Note", "note", 36],
            ],
            taskRows
        );

        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="wfh-report-${data.from}-to-${data.to}.xlsx"`);
        await wb.xlsx.write(res);
        res.end();
    } catch (e) {
        if (!res.headersSent) res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = router;