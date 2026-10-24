const mongoose = require("mongoose");

// module label -> mongoose model names that may be the target of that module's URL id
const MODULE_MODELS = {
  EMPLOYEE: ["Employee"],
  LEAVE: ["LeaveRequest"],
  ADVANCE: ["Advance"],
  PAYROLL: ["Payroll", "Payslip"],
  ATTENDANCE: ["Attendance", "MachineUser"],
  KPI: ["KpiTemplate", "KpiAssignment"],
  PERFORMANCE: ["OkrObjective", "PerformanceReview"],
  APPRAISAL: ["Appraisal"],
  AWARDS: ["EmployeeAward"],
  GRADING: ["DepartmentGradeSalary", "AssignGrade", "Grade"],
  FEEDBACK: ["FeedbackCycle", "FeedbackNomination"],
  TRAINING: ["TrainingProgram", "Program", "HrInduction", "AlumniProfile"],
  INCENTIVE: ["IncentivePlan", "IncentiveAssignment", "IncentiveResult", "VariablePay", "ImpactBonus", "Esop"],
  MASTERS: ["Department"],
  POLICY: ["Policy", "SOP", "PolicyQuiz"],
  ANNOUNCEMENT: ["Announcement"],
  WELLNESS: ["WellnessSession"],
  ENGAGEMENT: ["ClubEvent", "ClubMember"],
  RETENTION: ["RetentionPlan"],
  LEADERSHIP: ["LeadershipTrack"],
  SETTINGS: ["HrLeaveType", "HrHoliday", "HrShiftSettings", "Shift"],
  RECRUITMENT: ["HrApplicant", "WalkinApplicant", "Job", "Internship", "Applicant"],
  HR_ACCOUNT: ["HrStaff"],
  PRODUCTS: ["Product"],
};

const NAME_KEYS = [
  "employee_name", "employeeName", "name", "title",
  "template_name", "department_name", "shift_name", "plan_name",
];

const SENSITIVE = /pass(word)?|pwd|token|secret|otp|hash|authorization/i;
const isOid = (v) => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);

async function employeeLabel(id) {
  const E = mongoose.models.Employee;
  if (!E) return "";
  const e = await E.findById(id).select("name employeeId").lean();
  return e ? `${e.name || ""}${e.employeeId ? ` (${e.employeeId})` : ""}`.trim() : "";
}

// Human readable name of the record being acted on (employee, plan, announcement...)
async function describeEntity(module, id) {
  if (!isOid(String(id || ""))) return "";
  for (const modelName of MODULE_MODELS[module] || []) {
    const M = mongoose.models[modelName];
    if (!M) continue;
    let doc;
    try { doc = await M.findById(id).lean(); } catch { continue; }
    if (!doc) continue;

    if (modelName === "Employee") {
      return `${doc.name || ""}${doc.employeeId ? ` (${doc.employeeId})` : ""}`.trim();
    }
    for (const k of NAME_KEYS) {
      if (typeof doc[k] === "string" && doc[k].trim()) {
        const code = doc.employee_code || doc.empCode;
        return code ? `${doc[k].trim()} (${code})` : doc[k].trim();
      }
    }
    const ref = doc.employee_id || doc.employeeId;
    if (ref && isOid(String(ref))) {
      const l = await employeeLabel(ref);
      if (l) return l;
    }
  }
  // the id may simply be an employee id even if the module is something else
  try { return await employeeLabel(id); } catch { return ""; }
}

// Name from request body (used for CREATE where there is no id yet)
function nameFromBody(body) {
  if (!body || typeof body !== "object") return "";
  for (const k of NAME_KEYS) if (typeof body[k] === "string" && body[k].trim()) return body[k].trim().slice(0, 120);
  return "";
}

// Safe, short snapshot of what was submitted (no passwords / tokens / files)
function sanitizeBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const out = {};
  let n = 0;
  for (const [k, v] of Object.entries(body)) {
    if (n >= 15) break;
    if (SENSITIVE.test(k) || v == null || v === "") continue;
    if (typeof v === "string") {
      if (/^data:|base64,/i.test(v) || v.length > 2000) continue;
      out[k] = v.length > 120 ? v.slice(0, 120) + "…" : v;
    } else if (typeof v === "number" || typeof v === "boolean") out[k] = v;
    else if (Array.isArray(v)) out[k] = `[${v.length} items]`;
    else if (typeof v === "object") out[k] = "{…}";
    n++;
  }
  return Object.keys(out).length ? out : null;
}

const PAST = {
  CREATE: "created", UPDATE: "updated", DELETE: "deleted", APPROVE: "approved",
  REJECT: "rejected", REAPPROVE: "re-approved", RELIEVE: "relieved", FIRE: "terminated",
  ACTIVATE: "activated", DEACTIVATE: "deactivated access of", REACTIVATE: "reactivated",
  STATUS: "changed status of", ASSIGN: "assigned", CANCEL: "cancelled", SUBMIT: "submitted",
  PUBLISH: "published", UNPUBLISH: "unpublished", PROCESS: "processed", GENERATE: "generated",
  FINALIZE: "finalized", LOCK: "locked", UNLOCK: "unlocked", CLOSE: "closed", REOPEN: "reopened",
  REMOVE: "removed", RESET: "reset", SEND: "sent", IMPORT: "imported", MOVE_TO_PENDING: "moved to pending",
    UPLOAD: "uploaded document for", UPLOAD_DOC: "uploaded document for",   // UPLOAD_DOC NEW
  DELETE_DOC: "deleted document of",                                      // NEW
};
const LABEL = {
  LEAVE: "leave request", HR_ACCOUNT: "HR account", KPI: "KPI", PERFORMANCE: "performance record",
  RECRUITMENT: "recruitment record", MASTERS: "department master", SETTINGS: "HR setting",
};

function sentence(verb, module, name) {
  const v = PAST[verb] || verb.toLowerCase().replace(/_/g, " ");
  const label = LABEL[module] || module.toLowerCase().replace(/_/g, " ");
  const s = `${v} ${label}${name ? `: ${name}` : ""}`;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const MODULE_BY_TYPE = {
  Employee: "EMPLOYEE", HrApplicant: "RECRUITMENT", LeaveRequest: "LEAVE", HrStaff: "HR_ACCOUNT",
};
const describeByType = (type, id) =>
  describeEntity(MODULE_BY_TYPE[type] || String(type || "").toUpperCase(), id);

module.exports = { describeEntity, describeByType, nameFromBody, sanitizeBody, sentence };