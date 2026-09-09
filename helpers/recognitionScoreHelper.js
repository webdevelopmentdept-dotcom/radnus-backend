const EmployeeAward = require('../models/EmployeeAward');

// Keep these points in sync with AWARD_CONFIG in routes/employeeAwards.js
// and AWARD_CONFIG in src/pages/hr/AwardsDashboard.jsx
const POINTS = { spot: 10, monthly_star: 30, innovation: 50 };

/**
 * Computes an employee's Recognition Score from announced awards.
 * Used to feed the "Recognition" component of the PMS formula:
 *   PMS Score = KPI Achievement + Competency/Behaviour + Recognition (incl. Innovation)
 *
 * @param {String} employeeId
 * @param {Date|String} [fromDate] - filters by announced_at (period start)
 * @param {Date|String} [toDate]   - filters by announced_at (period end)
 */
async function computeRecognitionScore(employeeId, fromDate, toDate) {
  const match = { employee_id: employeeId, status: 'announced' };
  if (fromDate || toDate) {
    match.announced_at = {};
    if (fromDate) match.announced_at.$gte = new Date(fromDate);
    if (toDate) match.announced_at.$lte = new Date(toDate);
  }

  const awards = await EmployeeAward.find(match).select('award_type category cash_amount announced_at reason');

  const breakdown = {
    spot:         { count: 0, points: 0 },
    monthly_star: { count: 0, points: 0 },
    innovation:   { count: 0, points: 0 },
  };

  awards.forEach((a) => {
    if (breakdown[a.award_type]) {
      breakdown[a.award_type].count += 1;
      breakdown[a.award_type].points += POINTS[a.award_type] || 0;
    }
  });

  const total =
    breakdown.spot.points + breakdown.monthly_star.points + breakdown.innovation.points;

  return { breakdown, total, awards };
}

module.exports = { computeRecognitionScore, POINTS };