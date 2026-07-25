const router = require('express').Router();
const auth = require('../middleware/auth');
const Employee = require('../models/Employee');
const { ticketFetch } = require('../services/ticketService');

// GET /api/employee/tickets — logged-in employee's own tickets only
router.get('/tickets', auth, async (req, res) => {
  try {
    const employee = await Employee.findById(req.user.id).lean();
    if (!employee) return res.status(404).json({ error: 'Employee not found' });

    const allTickets = await ticketFetch('/tickets');
    const list = Array.isArray(allTickets) ? allTickets : [];

    const myTickets = list.filter(
      (t) =>
        t.emp_email &&
        employee.email &&
        t.emp_email.toLowerCase() === employee.email.toLowerCase()
    );

    res.json(myTickets);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.error || 'Failed to fetch your tickets' });
  }
});

module.exports = router;