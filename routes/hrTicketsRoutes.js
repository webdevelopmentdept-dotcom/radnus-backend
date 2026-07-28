const router = require('express').Router();
const auth = require('../middleware/auth');
const { ticketFetch } = require('../services/ticketService');

// GET all tickets (who raised what, status)
router.get('/tickets', auth, async (req, res) => {
  try {
    const data = await ticketFetch('/tickets');
    res.json(data);
  } catch (err) {
    console.error('HR tickets fetch error:', err);
    res.status(err.status || 500).json({ error: err.error || 'Failed to fetch tickets' });
  }
});

// GET single ticket detail
router.get('/tickets/:id', auth, async (req, res) => {
  try {
    const data = await ticketFetch(`/tickets/${req.params.id}`);
    res.json(data);
  } catch (err) {
    console.error('HR ticket detail fetch error:', err);
    res.status(err.status || 500).json({ error: err.error || 'Failed to fetch ticket' });
  }
});

// PATCH update status
router.patch('/tickets/:id', auth, async (req, res) => {
  try {
    const data = await ticketFetch(`/tickets/${req.params.id}`, {
      method: 'PATCH',
      body: JSON.stringify(req.body),
    });
    res.json(data);
  } catch (err) {
    console.error('HR ticket update error:', err);
    res.status(err.status || 500).json({ error: err.error || 'Failed to update ticket' });
  }
});

module.exports = router;