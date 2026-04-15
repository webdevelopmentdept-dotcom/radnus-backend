const express = require('express');
const router = express.Router();
const KpiAssignment = require('../models/KpiAssignment');
const KpiActual = require('../models/KpiActual');
const KpiTemplate = require('../models/KpiTemplate');
const { createNotification } = require('../helpers/notificationHelper');

// POST /api/kpi-assignments
router.post('/', async (req, res) => {
  try {
    const { employee_id, template_id, period, period_type, notes, assigned_by } = req.body;

    const existing = await KpiAssignment.findOne({
      employee_id,
      period,
      status: 'active'
    });
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'KPI already assigned to this employee for the selected period' 
      });
    }

    const assignment = new KpiAssignment({
      employee_id, template_id, period, period_type, notes, assigned_by
    });
    await assignment.save();

    await createNotification({
      recipient_id:   employee_id,
      recipient_role: "employee",
      type:           "hr",
      title:          "New KPI Assigned 🎯",
      message:        `KPIs have been assigned to you for ${period}. Check your targets.`,
      link:           "/employee/self-assessment"
    });

    res.status(201).json({ success: true, data: assignment });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ✅ GET /api/kpi-assignments/top-performers — முதல்ல வேணும்
router.get('/top-performers', async (req, res) => {
  try {
    const assignments = await KpiAssignment.find({ status: { $in: ['active', 'completed'] } })
      .populate('employee_id', 'name email department designation')
      .populate('template_id', 'template_name kpi_items')
      .sort({ createdAt: -1 });

    const topPerformers = assignments.map(a => ({
      name:        a.employee_id?.name        || '—',
      designation: a.employee_id?.designation || '—',
      department:  a.employee_id?.department  || '—',
      kpiScore:    Math.floor(Math.random() * 40) + 60,
      okrProgress: Math.floor(Math.random() * 40) + 60,
      status:      'Active',
    }));

    res.json({ success: true, data: topPerformers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-assignments/actuals/:assignmentId
router.get('/actuals/:assignmentId', async (req, res) => {
  try {
    const actuals = await KpiActual.find({ assignment_id: req.params.assignmentId });
    res.json({ success: true, data: actuals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/kpi-assignments/actuals
router.post('/actuals', async (req, res) => {
  try {
    const { assignment_id, actuals, entered_by } = req.body;

    const savedActuals = [];
    for (const item of actuals) {
      const saved = await KpiActual.findOneAndUpdate(
        { assignment_id, kpi_item_id: item.kpi_item_id },
        { actual_value: item.actual_value, entered_by },
        { upsert: true, new: true }
      );
      savedActuals.push(saved);
    }

    res.json({ success: true, data: savedActuals });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-assignments — All assignments (HR panel)
router.get('/', async (req, res) => {
  try {
    const assignments = await KpiAssignment.find()
      .populate('employee_id', 'name email department designation')
      .populate('template_id', 'template_name role department kpi_items')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ GET /api/kpi-assignments/:employeeId — கடைசில வேணும்
router.get('/:employeeId', async (req, res) => {
  try {
    const assignment = await KpiAssignment.findOne({
      employee_id: req.params.employeeId,
      status: { $in: ['active', 'completed'] }
    }).populate('template_id')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: assignment || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/kpi-assignments/:id
router.delete('/:id', async (req, res) => {
  try {
    await KpiAssignment.findByIdAndUpdate(req.params.id, { status: 'cancelled' });
    res.json({ success: true, message: 'Assignment cancelled' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;