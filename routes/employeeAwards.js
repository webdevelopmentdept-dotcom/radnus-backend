const express = require('express');
const router = express.Router();
const EmployeeAward = require('../models/EmployeeAward');
const { createNotification } = require('../helpers/notificationHelper');

// Award config per type
const AWARD_CONFIG = {
  spot: {
    label: 'Spot Award',
    cash_min: 500, cash_max: 1000,
    frequency: 'Anytime',
    eligibility: 'All employees',
  },
  monthly_star: {
    label: 'Monthly Star Award',
    cash_min: 3000, cash_max: 3000,
    frequency: 'Monthly',
    eligibility: 'Min 3 months service',
  },
  innovation: {
    label: 'Innovation Champion Award',
    cash_min: 5000, cash_max: 10000,
    frequency: 'Quarterly',
    eligibility: 'All employees (individuals or teams)',
  },
};

// GET all awards
router.get('/', async (req, res) => {
  try {
    const { award_type, status, period } = req.query;
    const filter = {};
    if (award_type) filter.award_type = award_type;
    if (status)     filter.status     = status;
    if (period)     filter.period     = period;

    const awards = await EmployeeAward.find(filter)
      .populate('employee_id', 'name email department designation')
      .populate('nominated_by', 'name designation')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: awards });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET summary stats
router.get('/summary', async (req, res) => {
  try {
    const [total, spot, monthly, innovation, announced] = await Promise.all([
      EmployeeAward.countDocuments(),
      EmployeeAward.countDocuments({ award_type: 'spot' }),
      EmployeeAward.countDocuments({ award_type: 'monthly_star' }),
      EmployeeAward.countDocuments({ award_type: 'innovation' }),
      EmployeeAward.countDocuments({ status: 'announced' }),
    ]);

    const totalCash = await EmployeeAward.aggregate([
      { $match: { status: 'announced' } },
      { $group: { _id: null, total: { $sum: '$cash_amount' } } }
    ]);

    res.json({
      success: true,
      data: {
        total, spot, monthly_star: monthly,
        innovation, announced,
        total_cash_distributed: totalCash[0]?.total || 0,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST nominate
router.post('/', async (req, res) => {
  try {
    const {
      award_type, employee_id, nominated_by,
      nomination_source, period, reason,
      achievement_details, cash_amount,
    } = req.body;

    if (!award_type || !employee_id || !reason) {
      return res.status(400).json({
        success: false,
        message: 'award_type, employee_id and reason are required'
      });
    }

    const award = new EmployeeAward({
      award_type, employee_id, nominated_by,
      nomination_source, period, reason,
      achievement_details,
      cash_amount: cash_amount || AWARD_CONFIG[award_type]?.cash_min || 0,
    });
    await award.save();

    // Notify employee
    await createNotification({
      recipient_id:   employee_id,
      recipient_role: 'employee',
      type:           'hr',
      title:          `🏆 You've been nominated for ${AWARD_CONFIG[award_type]?.label}!`,
      message:        `Your nomination is under review. Reason: ${reason}`,
      link:           '/employee/dashboard'
    });

    res.status(201).json({ success: true, data: award });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH — Update status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, hr_comment, dept_head_comment, cash_amount, wall_of_fame } = req.body;

    const award = await EmployeeAward.findById(req.params.id)
      .populate('employee_id', 'name email department');
    if (!award) return res.status(404).json({ success: false, message: 'Award not found' });

    award.status = status;
    if (hr_comment)         award.hr_comment         = hr_comment;
    if (dept_head_comment)  award.dept_head_comment  = dept_head_comment;
    if (cash_amount)        award.cash_amount         = cash_amount;
    if (wall_of_fame !== undefined) award.wall_of_fame = wall_of_fame;

    if (status === 'announced') {
      award.announced_at       = new Date();
      award.certificate_issued = true;

      // Notify employee of win
      await createNotification({
        recipient_id:   award.employee_id._id,
        recipient_role: 'employee',
        type:           'hr',
        title:          `🎉 Congratulations! You've won the ${AWARD_CONFIG[award.award_type]?.label}!`,
        message:        `Cash reward: ₹${award.cash_amount}. Keep up the great work!`,
        link:           '/employee/dashboard'
      });
    }

    await award.save();
    res.json({ success: true, data: award });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await EmployeeAward.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;