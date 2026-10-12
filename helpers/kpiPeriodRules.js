// helpers/kpiPeriodRules.js
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const GRACE_DAYS = 5;

// "September 2026" -> { year: 2026, month: 8 }
const parsePeriod = (period) => {
  const m = String(period || '').trim().match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTHS.findIndex(n => n.toLowerCase() === m[1].toLowerCase());
  return idx < 0 ? null : { year: Number(m[2]), month: idx };
};

// log_date "YYYY-MM-DD" must belong to the period month
const isDateInPeriod = (logDate, period) => {
  const p = parsePeriod(period);
  if (!p) return false;
  return String(logDate).startsWith(`${p.year}-${String(p.month + 1).padStart(2, '0')}`);
};

// Last day (inclusive) on which this period still accepts logs
const getLogDeadline = (period) => {
  const p = parsePeriod(period);
  if (!p) return null;
  // day GRACE_DAYS of next month, end of day
  return new Date(p.year, p.month + 1, GRACE_DAYS, 23, 59, 59, 999);
};

const isPeriodOpen = (period, now = new Date()) => {
  const d = getLogDeadline(period);
  return d ? now <= d : false;
};

const currentPeriod = (now = new Date()) => `${MONTHS[now.getMonth()]} ${now.getFullYear()}`;

module.exports = { MONTHS, GRACE_DAYS, parsePeriod, isDateInPeriod, getLogDeadline, isPeriodOpen, currentPeriod };