// helpers/kpiCycleLogic.js
//
// Employee-wise 3-month KPI cycles (NOT calendar quarters).
//
//  • Cycle 1 starts in the employee's FIRST KPI month = the earliest month a KPI was
//    assigned (KpiAssignment.period) or reviewed (PerformanceReview.period).
//      - IT dept: no July assignment, first score is Aug  -> Aug, Sep, Oct
//      - New joiner (joined Aug, first score Sep)          -> Sep, Oct, Nov
//      - Older employee (Jul, Aug scored)                  -> Jul, Aug, Sep
//  • Policy: KPI applies from the 2nd month after joining, so the cycle can never
//    start on/before the joining month:  anchor = max(firstReviewMonth, joiningMonth + 1)
//  • Every cycle is 3 months. Once the 3rd month is reviewed the cycle is "closed"
//    (status is final) and the next cycle starts in the following month.
//  • Cycle target: sum of the 3 monthly scores >= 150  (50% x 3 months).
//    "50% every month" already implies the 150% total, so one check is enough.
//  • Monthly score = PerformanceReview.final_score (max 100 per review).
//    Several reviews in the same month -> average.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const MIN_PER_MONTH = 50;
const MAX_PER_MONTH = 100;
const CYCLE_LEN = 3;
const CYCLE_REQUIRED = MIN_PER_MONTH * CYCLE_LEN; // 150

// "August 2026" -> absolute month number (year * 12 + monthIndex). null if unparseable.
const periodToAbs = (period) => {
  const m = String(period || '').trim().match(/^([A-Za-z]{3,})\s+(\d{4})$/);
  if (!m) return null;
  const idx = MONTHS.findIndex(n => n.slice(0, 3).toLowerCase() === m[1].slice(0, 3).toLowerCase());
  if (idx < 0) return null;
  return Number(m[2]) * 12 + idx;
};

const absToLabel = (abs) => `${MONTHS[abs % 12].slice(0, 3)} ${Math.floor(abs / 12)}`;
const round1 = (n) => Math.round(n * 10) / 10;

const evaluateStatus = (achieved, pending) => {
  const needed = Math.max(0, round1(CYCLE_REQUIRED - achieved));
  if (achieved >= CYCLE_REQUIRED) return { status: 'compliant', needed: 0 };
  if (pending === 0 || needed > pending * MAX_PER_MONTH) return { status: 'non_compliant', needed };
  return { status: 'at_risk', needed };
};

const buildNote = (status, needed, pending, closed) => {
  if (status === 'compliant') return closed ? 'Cycle completed – target met' : 'Target already met';
  if (status === 'at_risk') return `Needs ${needed}% more (${pending} month${pending > 1 ? 's' : ''} pending)`;
  return closed
    ? `Missed target by ${needed}%`
    : `Needs ${needed}% but only ${pending * MAX_PER_MONTH}% still possible`;
};

/**
 * @param {Map<number, number[]>} scoresByAbs  absMonth -> list of final_scores (finalized reviews)
 * @param {number|null} joinAbs                absMonth of joining date (null if unknown)
 * @param {number} refAbs                      "today" as absMonth
 * @param {number[]} assignedAbs               absMonths where a KPI was assigned (not cancelled)
 * @returns {{ state: 'active'|'exempt'|'not_started', currentIndex: number, cycles: object[] }}
 */
const buildCycles = (scoresByAbs, joinAbs, refAbs, assignedAbs = []) => {
  const firstAllowed = joinAbs != null ? joinAbs + 1 : -Infinity;

  // months that count: assigned or reviewed, and after the joining month
  const reviewed = [...new Set([...scoresByAbs.keys(), ...assignedAbs])]
    .filter(a => a >= firstAllowed).sort((a, b) => a - b);

  if (!reviewed.length) {
    const state = joinAbs != null && refAbs <= joinAbs ? 'exempt' : 'not_started';
    return { state, currentIndex: -1, cycles: [] };
  }

  const anchor = reviewed[0];
  const idxOf = (abs) => Math.floor((abs - anchor) / CYCLE_LEN);
  const currentIndex = Math.max(0, idxOf(refAbs));
  const lastIndex = Math.max(currentIndex, idxOf(reviewed[reviewed.length - 1]));

  const cycles = [];
  for (let i = 0; i <= lastIndex; i++) {
    const start = anchor + i * CYCLE_LEN;

    const months = [0, 1, 2].map(k => {
      const abs = start + k;
      const list = scoresByAbs.get(abs);
      const score = list && list.length ? round1(list.reduce((a, b) => a + b, 0) / list.length) : null;
      const state = score !== null ? 'reviewed' : abs > refAbs ? 'upcoming' : 'pending';
      return { label: absToLabel(abs), period: `${MONTHS[abs % 12]} ${Math.floor(abs / 12)}`, score, state };
    });

    const achieved = round1(months.reduce((s, m) => s + (m.score || 0), 0));
    const pending = months.filter(m => m.state !== 'reviewed').length;
    const closed = pending === 0;
    const { status, needed } = evaluateStatus(achieved, pending);

    cycles.push({
      index: i + 1,
      start_label: absToLabel(start),
      end_label: absToLabel(start + CYCLE_LEN - 1),
      months,
      required: CYCLE_REQUIRED,
      achieved,
      needed,
      pending,
      closed,               // true -> all 3 months reviewed, status is final
      status,
      note: buildNote(status, needed, pending, closed),
    });
  }

  return { state: 'active', currentIndex, cycles };
};

module.exports = {
  MONTHS, MIN_PER_MONTH, MAX_PER_MONTH, CYCLE_LEN, CYCLE_REQUIRED,
  periodToAbs, absToLabel, buildCycles,
};