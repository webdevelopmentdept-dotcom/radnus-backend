const express = require('express');
const router = express.Router();
const VariablePay = require('../models/VariablePay');
const KpiAssignment = require('../models/KpiAssignment');
const PerformanceReview = require('../models/PerformanceReview');

// Score calculation (policy 3.24 weightage)
const calcPerformanceScore = (okr, kpi, feedback, innovation) => {
  return Math.round(
    (okr * 0.40) + (kpi * 0.30) + (feedback * 0.20) + (innovation * 0.10)
  );
};

// GET all variable pay records (HR view)
router.get('/', async (req, res) => {
  try {
    const records = await VariablePay.find()
      .populate('employee_id', 'name email department designation')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single employee variable pay
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const records = await VariablePay.find({ 
      employee_id: req.params.employeeId 
    }).sort({ createdAt: -1 });
    res.json({ success: true, data: records });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST — Calculate & save variable pay
router.post('/calculate', async (req, res) => {
  try {
    const {
      employee_id, assignment_id, period,
      employee_category, annual_ctc, variable_pct,
      okr_score, kpi_score, feedback_score, innovation_score,
      notes, calculated_by
    } = req.body;

    const performance_score = calcPerformanceScore(
      okr_score, kpi_score, feedback_score, innovation_score
    );
    
    const variable_pay_amount = Math.round(
      annual_ctc * (variable_pct / 100) * (performance_score / 100)
    );

    // Check if record exists for same employee + period
    const existing = await VariablePay.findOne({ employee_id, period });
    
    if (existing) {
      // Update existing
      Object.assign(existing, {
        employee_category, annual_ctc, variable_pct,
        okr_score, kpi_score, feedback_score, innovation_score,
        performance_score, variable_pay_amount,
        notes, calculated_by, status: 'draft'
      });
      await existing.save();
      return res.json({ success: true, data: existing });
    }

    const record = new VariablePay({
      employee_id, assignment_id, period,
      employee_category, annual_ctc, variable_pct,
      okr_score, kpi_score, feedback_score, innovation_score,
      performance_score, variable_pay_amount,
      notes, calculated_by
    });
    await record.save();
    res.status(201).json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH — Approve variable pay
router.patch('/:id/approve', async (req, res) => {
  try {
    const record = await VariablePay.findByIdAndUpdate(
      req.params.id,
      { status: 'approved', approved_by: req.body.approved_by },
      { new: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH — Mark as paid
router.patch('/:id/paid', async (req, res) => {
  try {
    const record = await VariablePay.findByIdAndUpdate(
      req.params.id,
      { status: 'paid' },
      { new: true }
    );
    res.json({ success: true, data: record });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await VariablePay.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;