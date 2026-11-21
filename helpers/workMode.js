// helpers/workMode.js
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// dateStr = "YYYY-MM-DD"  →  "office" | "wfh"
function getEffectiveWorkMode(emp, dateStr) {
  if (!emp || !emp.workMode || emp.workMode === "office") return "office";
  if (emp.wfhFrom && dateStr < emp.wfhFrom) return "office";
  if (emp.wfhTo && dateStr > emp.wfhTo) return "office";
  if (emp.workMode === "wfh") return "wfh";

  // hybrid
  const day = DAYS[new Date(dateStr + "T00:00:00").getDay()];
  return (emp.wfhDays || []).includes(day) ? "wfh" : "office";
}

module.exports = { getEffectiveWorkMode };