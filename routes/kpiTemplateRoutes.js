const express = require('express');
const router = express.Router();
const KpiTemplate = require('../models/KpiTemplate');

// GET all templates
router.get('/', async (req, res) => {
  try {
    const templates = await KpiTemplate.find({ is_active: true });
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET single template
router.get('/:id', async (req, res) => {
  try {
    const template = await KpiTemplate.findById(req.params.id);
    if (!template) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST create template
router.post('/', async (req, res) => {
  try {
    const template = new KpiTemplate(req.body);
    await template.save();
    res.status(201).json({ success: true, data: template });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT update template
router.put('/:id', async (req, res) => {
  try {
    const template = await KpiTemplate.findByIdAndUpdate(
      req.params.id, req.body, { new: true }
    );
    res.json({ success: true, data: template });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE (soft delete)
router.delete('/:id', async (req, res) => {
  try {
    await KpiTemplate.findByIdAndUpdate(req.params.id, { is_active: false });
    res.json({ success: true, message: 'Template deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;