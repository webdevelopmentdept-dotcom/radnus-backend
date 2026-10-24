const HrAuditLog = require("../models/HrAuditLog");
const { describeEntity, nameFromBody, sanitizeBody, sentence } = require("../helpers/auditEnrich");

// Automatically records every successful write (POST/PUT/PATCH/DELETE) made by a
// logged-in HR / MD / Admin / Test account. Read-only (GET) requests are ignored.
// It never blocks or changes a request; any failure here is only printed.
const OID = /^[a-f0-9]{24}$/i;
const RECORD_MODULES = new Set(["KPI", "PERFORMANCE", "APPRAISAL", "AWARDS", "TRAINING", "INCENTIVE", "RECRUITMENT"]);
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

// Noise we do not want in the activity log
const SKIP = [
    /^\/api\/notifications/i,
    /^\/api\/push/i,
    /^\/api\/admin\/hr-activity/i,
    /\/(login|logout)$/i,
];

// path pattern -> module label (first match wins)
const MODULES = [
    [/\/admin\/hr-staff/i, "HR_ACCOUNT"],
    [/\/payroll/i, "PAYROLL"],
    [/\/leave/i, "LEAVE"],
    [/\/(attendance|daily-logs|machine-staff|essl)/i, "ATTENDANCE"],
    [/\/advance/i, "ADVANCE"],
    [/\/kpi/i, "KPI"],
    [/\/(okr|performance-reviews|department-scoreboard)/i, "PERFORMANCE"],
    [/\/appraisal/i, "APPRAISAL"],
    [/\/(employee-awards|awards)/i, "AWARDS"],
    [/\/(grade-master|assign-grade|dept-grade-salary)/i, "GRADING"],
    [/\/feedback/i, "FEEDBACK"],
    [/\/(training|rca|hr-induction|programs|alumni)/i, "TRAINING"],
    [/\/(incentive|variable-pay|impact-bonus|esop)/i, "INCENTIVE"],
    [/\/departments/i, "MASTERS"],
    [/\/(policies|policy-quiz|sops)/i, "POLICY"],
    [/\/announcements/i, "ANNOUNCEMENT"],
    [/\/wellness/i, "WELLNESS"],
    [/\/(clubs|engagement)/i, "ENGAGEMENT"],
    [/\/retention/i, "RETENTION"],
    [/\/(leadership)/i, "LEADERSHIP"],
    [/\/tickets/i, "TICKETS"],
    [/\/hr\/settings|\/leave-types/i, "SETTINGS"],
    [/\/(jobs|walkin|applications|applicants|internship)/i, "RECRUITMENT"],
    [/\/(employee|hr\/pending|hr\/activation|hr\/approve|hr\/reject|hr\/reapprove|hr\/move)/i, "EMPLOYEE"],
    [/\/(loan|admin-loan)/i, "LOAN"],
    [/\/products/i, "PRODUCTS"],
];

// last path word that describes the action (e.g. /employees/:id/relieve -> RELIEVE)
const VERB_WORDS = new Set([
    "approve", "reject", "reapprove", "relieve", "fire", "activate", "deactivate",
    "reactivate", "status", "publish", "unpublish", "assign", "cancel", "submit",
    "process", "generate", "finalize", "lock", "unlock", "close", "reopen", "upload",
    "remove", "reset", "send", "import", "move-to-pending", "password", "shift",
    "deactivate-access", "hr-mark", "upload-doc", "delete-doc", "paid", "screen", "allocate", "final", "applicant-status"
]);

function moduleFor(path) {
    for (const [re, label] of MODULES) if (re.test(path)) return label;
    const seg = path.split("/").filter(Boolean).find((s) => s !== "api" && s !== "hr");
    return (seg || "OTHER").toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function verbFor(method, route) {
    const segs = String(route || "").split("/").filter((s) => s && !s.startsWith(":"));
    const last = (segs[segs.length - 1] || "").toLowerCase();
    if (VERB_WORDS.has(last)) return last.toUpperCase().replace(/-/g, "_");
    if (method === "POST") return "CREATE";
    if (method === "DELETE") return "DELETE";
    return "UPDATE";
}

module.exports = (req, res, next) => {
    if (!WRITE_METHODS.has(req.method)) return next();

    const path = (req.originalUrl || "").split("?")[0];
    const module_ = moduleFor(path);
    let resBody;
    const origJson = res.json.bind(res);
    res.json = (body) => { resBody = body; return origJson(body); };
    const idMatch = path.match(/[a-f0-9]{24}/i);

    // Look the record up BEFORE the handler runs, so a deleted employee / plan
    // can still be shown by name in the log.
    let namePromise = null;
    if (req.actor && idMatch && !SKIP.some((re) => re.test(path))) {
        namePromise = describeEntity(module_, idMatch[0]).catch(() => "");
    }

    res.on("finish", async () => {
        try {
            // only logged-in HR/MD/Admin/Test, only successful writes,
            // and skip anything already recorded by logAction()
            if (!req.actor || req._audited || res.statusCode >= 400) return;
            if (SKIP.some((re) => re.test(path))) return;

            const route = req.route ? String((req.baseUrl || "") + req.route.path) : "";
            const verb = verbFor(req.method, route || path);
            const b = req.body || {};
            const bodyId = [b.employeeId, b.employee_id, b.employee]
                .map((v) => (v && typeof v === "object" ? v._id : v))
                .find((v) => OID.test(String(v || "")));
            const respId = [resBody?.data?._id, resBody?.job?._id, resBody?._id]
                .map(String).find((v) => OID.test(v));
            const entityId = idMatch ? idMatch[0]
                : (verb === "CREATE" && respId && RECORD_MODULES.has(module_)) ? respId
                    : (bodyId ? String(bodyId) : "");
            let entityName = (namePromise && (await namePromise)) || "";
            if (!entityName && entityId) entityName = await describeEntity(module_, entityId).catch(() => "");
            if (!entityName) entityName = nameFromBody(req.body);
            const a = req.actor;

            await HrAuditLog.create({
                actorId: String(a.id || ""),
                actorName: a.name || "Unknown",
                actorEmail: a.email || "",
                actorRole: a.role || "",
                isTest: !!a.isTest,
                action: `${module_}_${verb}`,
                entityType: module_,
                // entityId: idMatch ? idMatch[0] : "",
                entityId,
                entityName,
                remarks: sentence(verb, module_, entityName),
                meta: {
                    auto: true,
                    method: req.method,
                    route,
                    path,
                    status: res.statusCode,
                    body: sanitizeBody(req.body),
                },
            });
        } catch (e) {
            console.error("auditWrites failed:", e.message);
        }
    });

    next();
};