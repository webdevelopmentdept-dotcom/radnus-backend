const express = require('express');
const router = express.Router();
const DailyLog = require('../models/DailyLog');

// POST /api/daily-logs — Add a daily log entry
router.post('/', async (req, res) => {
  try {
    const { 
      employee_id, assignment_id, kpi_item_id, 
      kpi_name, unit, value, note, log_date, period,
      program_values  // ✅ ADD THIS
    } = req.body;

    const log = new DailyLog({
      employee_id, assignment_id, kpi_item_id,
      kpi_name, unit, value, note, log_date, period,
      program_values: program_values || {}  // ✅ ADD THIS
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
    await DailyLog.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Log deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;