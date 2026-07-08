const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const KpiAssignment = require('../models/KpiAssignment');
const KpiActual = require('../models/KpiActual');
const KpiTemplate = require('../models/KpiTemplate');
const KpiMonthlyVersion = require('../models/KpiMonthlyVersion');
const { createNotification } = require('../helpers/notificationHelper');

// POST /api/kpi-assignments
router.post('/', async (req, res) => {
  try {
    const { employee_id, template_id, period, period_type, notes, assigned_by } = req.body;

    if (!notes || !notes.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Notes / Instructions are required'
      });
    }

    // Validate ObjectIds
    if (!mongoose.Types.ObjectId.isValid(employee_id) || !mongoose.Types.ObjectId.isValid(template_id)) {
      return res.status(400).json({ success: false, message: 'Invalid employee_id or template_id' });
    }

    // Find month version for this template + period
    const monthVersion = await KpiMonthlyVersion.findOne({
      template_id: new mongoose.Types.ObjectId(template_id),
      month: { $regex: new RegExp(`^${period}$`, 'i') },
      month_status: { $in: ['active', 'locked'] }
    });

    if (!monthVersion) {
      return res.status(400).json({
        success: false,
        message: `No version found for ${period}. Create month version in KPI Templates first.`
      });
    }

    // Check existing assignment
    const existing = await KpiAssignment.findOne({
      employee_id: new mongoose.Types.ObjectId(employee_id),
      period,
      status: 'active'
    });
    if (existing) {
      return res.status(400).json({
        success: false,
        message: 'KPI already assigned to this employee for the selected period'
      });
    }

    // Create assignment
    const assignment = new KpiAssignment({
      employee_id: new mongoose.Types.ObjectId(employee_id),
      template_id: new mongoose.Types.ObjectId(template_id),
      month_version_id: monthVersion._id,
      period,
      period_type,
      notes: notes.trim(),
      assigned_by: assigned_by ? new mongoose.Types.ObjectId(assigned_by) : null
    });
    await assignment.save();

    // Populate before response
    const populated = await KpiAssignment.findById(assignment._id)
      .populate('employee_id', 'name email department designation')
      .populate('template_id', 'template_name role department kpi_items')
      .populate('month_version_id', 'month month_status kpi_items');

    // Notification
    await createNotification({
      recipient_id: employee_id,
      recipient_role: "employee",
      type: "hr",
      title: "New KPI Assigned 🎯",
      message: `KPIs have been assigned to you for ${period}. Check your targets.`,
      link: "/employee/self-assessment"
    });

    res.status(201).json({
      success: true,
      data: populated
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-assignments/top-performers
router.get('/top-performers', async (req, res) => {
  try {
    const assignments = await KpiAssignment.find({ status: { $in: ['active', 'completed'] } })
      .populate('employee_id', 'name email department designation')
      .populate('template_id', 'template_name kpi_items')
      .populate('month_version_id', 'month month_status')
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
      .populate('month_version_id', 'month month_status kpi_items')  // ✅ FIXED
      .sort({ createdAt: -1 });

    res.json({ success: true, data: assignments });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/kpi-assignments/:id
router.put('/:id', async (req, res) => {
  try {
    console.log("PUT hit — id:", req.params.id);
    console.log("Body:", req.body);

    const { employee_id, template_id, month_version_id, period, period_type, notes } = req.body;

    if (!notes || !notes.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Notes / Instructions are required'
      });
    }

    const updateData = {
      employee_id: new mongoose.Types.ObjectId(employee_id),
      template_id: new mongoose.Types.ObjectId(template_id),
      period,
      period_type,
      notes: notes.trim()
    };

    // Only update month_version_id if provided
    if (month_version_id) {
      updateData.month_version_id = new mongoose.Types.ObjectId(month_version_id);
    }

    const updated = await KpiAssignment.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate('employee_id', 'name email department designation')
      .populate('template_id', 'template_name role department kpi_items')
      .populate('month_version_id', 'month month_status kpi_items');  // ✅ FIXED

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/kpi-assignments/:id/cancel
router.patch('/:id/cancel', async (req, res) => {
  try {
    const updated = await KpiAssignment.findByIdAndUpdate(
      req.params.id,
      { status: 'cancelled' },
      { new: true }
    )
    .populate('employee_id', 'name email department designation')
    .populate('template_id', 'template_name role department kpi_items')
    .populate('month_version_id', 'month month_status kpi_items');

    if (!updated) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }
    res.json({ success: true, message: 'Assignment cancelled', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/kpi-assignments/:employeeId
router.get('/:employeeId', async (req, res) => {
  try {
    const SelfAssessment = require('../models/SelfAssessment');

    const assignments = await KpiAssignment.find({
      employee_id: req.params.employeeId,
      status: { $in: ['active', 'completed'] }
    })
      .populate('template_id')
      .populate('month_version_id', 'month month_status kpi_items')  // ✅ FIXED
      .sort({ createdAt: 1 });

    if (!assignments.length) {
      return res.json({ success: true, data: null });
    }

    for (const assignment of assignments) {
      const existing = await SelfAssessment.findOne({
        employee_id: req.params.employeeId,
        assignment_id: assignment._id
      });

      if (!existing || existing.status === 'draft') {
        // console.log("Returning pending:", assignment.period);
        return res.json({ success: true, data: assignment });
      }
    }

    const latest = assignments[assignments.length - 1];
    console.log("All submitted, returning latest:", latest.period);
    return res.json({ success: true, data: latest });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/kpi-assignments/:id
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await KpiAssignment.findByIdAndDelete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ success: false, message: 'Assignment not found' });
    }
    res.json({ success: true, message: 'Assignment deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;