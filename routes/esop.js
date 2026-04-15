const express = require('express');
const router  = express.Router();
const Esop    = require('../models/Esop');
const { createNotification } = require('../helpers/notificationHelper');

const GRADE_CONFIG = {
  L6:  { designation: 'Senior Manager',  min: 0.05, max: 0.10 },
  L7:  { designation: 'General Manager', min: 0.10, max: 0.25 },
  L8:  { designation: 'AVP',             min: 0.25, max: 0.50 },
  L9:  { designation: 'VP',              min: 0.50, max: 1.00 },
  L10: { designation: 'Director / CXO',  min: 1.00, max: 3.00 },
};

// GET all ESOP grants
router.get('/', async (req, res) => {
  try {
    const { grade, status } = req.query;
    const filter = {};
    if (grade)  filter.grade  = grade;
    if (status) filter.status = status;

    const grants = await Esop.find(filter)
      .populate('employee_id', 'name email department designation')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: grants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET summary
router.get('/summary', async (req, res) => {
  try {
    const [total, granted, vesting, vested, exercised, forfeited] = await Promise.all([
      Esop.countDocuments(),
      Esop.countDocuments({ status: 'granted' }),
      Esop.countDocuments({ status: 'vesting' }),
      Esop.countDocuments({ status: 'vested' }),
      Esop.countDocuments({ status: 'exercised' }),
      Esop.countDocuments({ status: 'forfeited' }),
    ]);

    const totalOptions = await Esop.aggregate([
      { $group: { _id: null, total: { $sum: '$total_options' } } }
    ]);

    res.json({
      success: true,
      data: { total, granted, vesting, vested, exercised, forfeited,
        total_options: totalOptions[0]?.total || 0 }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET employee ESOP
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const grants = await Esop.find({ employee_id: req.params.employeeId })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: grants });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST grant ESOP
router.post('/', async (req, res) => {
  try {
    const {
      employee_id, grade, designation,
      total_options, allocation_pct, exercise_price,
      company_valuation, grant_date, vesting_start,
      approved_by, notes, payout_method
    } = req.body;

    if (!employee_id || !grade || !total_options || !exercise_price) {
      return res.status(400).json({
        success: false,
        message: 'employee_id, grade, total_options, exercise_price required'
      });
    }

    const esop = new Esop({
      employee_id, grade, designation,
      total_options, allocation_pct, exercise_price,
      company_valuation, approved_by, notes, payout_method,
      grant_date: grant_date || new Date(),
      vesting_start: vesting_start || new Date(),
      status: 'granted'
    });
    await esop.save();

    await createNotification({
      recipient_id:   employee_id,
      recipient_role: 'employee',
      type:           'hr',
      title:          '🎉 ESOP Grant Issued!',
      message:        `You have been granted ${total_options} stock options under R-ESOP. Check your ESOP details.`,
      link:           '/employee/dashboard'
    });

    res.status(201).json({ success: true, data: esop });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH update status
router.patch('/:id/status', async (req, res) => {
  try {
    const { status, exercised_options, payout_method } = req.body;
    const esop = await Esop.findById(req.params.id);
    if (!esop) return res.status(404).json({ success: false, message: 'Not found' });

    esop.status = status;
    if (exercised_options) esop.exercised_options = exercised_options;
    if (payout_method)     esop.payout_method     = payout_method;
    if (status === 'exercised') esop.exercised_at = new Date();

    await esop.save();
    res.json({ success: true, data: esop });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await Esop.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'ESOP grant deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;