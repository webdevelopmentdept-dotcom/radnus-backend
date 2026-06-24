const express = require('express');
const router = express.Router();
const DailyLog = require('../models/DailyLog');
const mongoose = require('mongoose');  // ✅ ADD THIS


// POST /api/daily-logs — Add a daily log entry
// router.post('/', async (req, res) => {
//   try {
//     const { 
//       employee_id, assignment_id, kpi_item_id, 
//       kpi_name, unit, value, note, log_date, period,
//       program_values , extra_fields
//     } = req.body;

//     const log = new DailyLog({
//       employee_id, assignment_id, kpi_item_id,
//       kpi_name, unit, value, note, log_date, period,
//       program_values: program_values || {},
//       extra_fields: extra_fields || {}  // ✅ ADD THIS
//     });
//     await log.save();

//     res.status(201).json({ success: true, data: log });
//   } catch (err) {
//     res.status(400).json({ success: false, message: err.message });
//   }
// });

router.post('/', async (req, res) => {
  try {
    const { 
      employee_id, assignment_id, kpi_item_id, 
      kpi_name, unit, value, note, log_date, period,
      program_values, extra_fields
    } = req.body;

    // ✅ AUTO-FIX: If assignment_id missing, find active assignment
    let finalAssignmentId = assignment_id;
    if (!finalAssignmentId) {
      const KpiAssignment = require('../models/KpiAssignment');
      const assignment = await KpiAssignment.findOne({
        employee_id: new mongoose.Types.ObjectId(employee_id),
        period: period,
        status: { $in: ['active', 'completed'] }
      });
      if (assignment) {
        finalAssignmentId = assignment._id;
      }
    }

    const log = new DailyLog({
      employee_id, 
      assignment_id: finalAssignmentId,  // ✅ Use fixed assignment_id
      kpi_item_id,
      kpi_name, unit, value, note, log_date, period,
      program_values: program_values || {},
      extra_fields: extra_fields || {}
    });
    await log.save();

    res.status(201).json({ success: true, data: log });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// GET /api/daily-logs/:employeeId/:assignmentId — Get all logs for assignment
router.get('/:employeeId/:assignmentId', async (req, res) => {
  try {
    const logs = await DailyLog.find({
      employee_id: req.params.employeeId,
      assignment_id: req.params.assignmentId
    }).sort({ log_date: -1 });

    res.json({ success: true, data: logs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/daily-logs/totals/:employeeId/:assignmentId — Get total per KPI
router.get('/totals/:employeeId/:assignmentId', async (req, res) => {
  try {
    const logs = await DailyLog.find({
      employee_id: req.params.employeeId,
      assignment_id: req.params.assignmentId
    });

    // Sum values per kpi_item_id
    const totals = {};
    logs.forEach(log => {
      if (!totals[log.kpi_item_id]) totals[log.kpi_item_id] = 0;
      totals[log.kpi_item_id] += log.value;
    });

    res.json({ success: true, data: totals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/daily-logs/:id — Delete a log entry
router.delete('/:id', async (req, res) => {
  try {
    const log = await DailyLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: 'Log not found' });

    const diffHours = (new Date() - new Date(log.createdAt)) / (1000 * 60 * 60);
    if (diffHours > 24) {
      return res.status(403).json({ success: false, message: 'Delete not allowed after 24 hours' });
    }

    await DailyLog.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Log deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


router.put('/:id', async (req, res) => {
  try {
    const log = await DailyLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: 'Log not found' });

    const diffHours = (new Date() - new Date(log.createdAt)) / (1000 * 60 * 60);
    if (diffHours > 24) {
      return res.status(403).json({ success: false, message: 'Edit not allowed after 24 hours' });
    }

    const historyEntry = {
      oldValue: log.value,
      newValue: req.body.value,
      oldNote: log.note,
      newNote: req.body.note,
      editedAt: new Date()
    };

    const updated = await DailyLog.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          value: req.body.value,
          note: req.body.note,
          isEdited: true,
          updatedAt: new Date()
        },
        $push: { editHistory: historyEntry }
      },
      { new: true }
    );

    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;