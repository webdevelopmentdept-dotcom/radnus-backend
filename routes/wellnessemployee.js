const express = require('express');
const router = express.Router();
const WellnessKpi = require('../models/Wellness');
const KpiAssignment = require('../models/KpiAssignment');

// GET /api/wellness-employee/my-assignments/:employeeId
router.get('/my-assignments/:employeeId', async (req, res) => {
  const assignments = await KpiAssignment.find({ 
    employee_id: req.params.employeeId, 
    category: 'wellness',
    status: 'active' 
  }).populate('template_id');
  res.json({ success: true, data: assignments });
});

// POST /api/wellness-employee/actuals
router.post('/actuals', async (req, res) => {
  const actual = new WellnessKpi({ ...req.body, is_anonymous: true });
  await actual.save();
  res.json({ success: true, message: 'Logged anonymously' });
});

module.exports = router;