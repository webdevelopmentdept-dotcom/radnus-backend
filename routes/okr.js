// routes/okr.js
// Mount in server.js:  app.use('/api/okr', require('./routes/okr'));

const express = require('express');
const router  = express.Router();
const OkrObjective = require('../models/OkrObjective');
const KpiTemplate  = require('../models/KpiTemplate');

// ─────────────────────────────────────────────
// HELPER: empty string → null fix
// ─────────────────────────────────────────────
const sanitizeKeyResults = (key_results) => {
  if (!key_results || !Array.isArray(key_results)) return key_results;
  return key_results.map(kr => ({
    ...kr,
    linked_kpi_item_id: (kr.linked_kpi_item_id === "" || kr.linked_kpi_item_id === undefined) ? null : kr.linked_kpi_item_id,
    linked_template_id: (kr.linked_template_id === "" || kr.linked_template_id === undefined) ? null : kr.linked_template_id,
  }));
};

// ─────────────────────────────────────────────
// GET /api/okr/templates/all
// ⚠️ MUST be before /:id route — otherwise Express
//    treats "templates" as an :id param → 404
// ─────────────────────────────────────────────
router.get('/templates/all', async (req, res) => {
  try {
    const templates = await KpiTemplate.find({ is_active: true })
      .select('template_name role department kpi_items');
    res.json({ success: true, data: templates });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/okr  — All objectives (with filters)
// ─────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const filter = {};
    if (req.query.department) filter.department = req.query.department;
    if (req.query.status)     filter.status     = req.query.status;
    if (req.query.quarter)    filter.quarter    = req.query.quarter;
    if (req.query.year)       filter.year       = req.query.year;

    const objectives = await OkrObjective.find(filter)
      .populate('key_results.linked_template_id', 'template_name role department')
      .sort({ createdAt: -1 });

    res.json({ success: true, data: objectives });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/okr/by-department/:dept
// ─────────────────────────────────────────────
router.get('/by-department/:dept', async (req, res) => {
  try {
    const objectives = await OkrObjective.find({
      department: req.params.dept,
      status: 'active'
    }).sort({ createdAt: -1 });

    res.json({ success: true, data: objectives });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// GET /api/okr/:id  — Single objective
// ⚠️ Keep this AFTER all named routes like /templates/all
// ─────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const obj = await OkrObjective.findById(req.params.id)
      .populate('key_results.linked_template_id', 'template_name role department kpi_items');
    if (!obj) return res.status(404).json({ success: false, message: 'OKR not found' });
    res.json({ success: true, data: obj });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// POST /api/okr  — Create OKR Objective
// ─────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const { title, description, department, quarter, year, key_results, created_by } = req.body;

    if (!title || !department) {
      return res.status(400).json({ success: false, message: 'Title and department are required' });
    }
    if (!key_results || key_results.length === 0) {
      return res.status(400).json({ success: false, message: 'At least one Key Result is required' });
    }

    const totalWeight = key_results.reduce((s, kr) => s + (parseFloat(kr.weight) || 0), 0);
    if (Math.round(totalWeight) !== 100) {
      return res.status(400).json({ success: false, message: `KR weights must sum to 100%. Currently: ${totalWeight}%` });
    }

    const cleanedKRs = sanitizeKeyResults(key_results);

    const objective = new OkrObjective({
      title, description, department, quarter, year,
      key_results: cleanedKRs, created_by
    });
    await objective.save();

    res.status(201).json({ success: true, data: objective });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// PUT /api/okr/:id  — Update OKR
// ─────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  try {
    const { title, description, department, quarter, year, key_results, status } = req.body;

    if (key_results) {
      const totalWeight = key_results.reduce((s, kr) => s + (parseFloat(kr.weight) || 0), 0);
      if (Math.round(totalWeight) !== 100) {
        return res.status(400).json({ success: false, message: `KR weights must sum to 100%. Currently: ${totalWeight}%` });
      }
    }

    const obj = await OkrObjective.findById(req.params.id);
    if (!obj) return res.status(404).json({ success: false, message: 'OKR not found' });

    if (title)                     obj.title       = title;
    if (description !== undefined) obj.description = description;
    if (department)                obj.department  = department;
    if (quarter)                   obj.quarter     = quarter;
    if (year)                      obj.year        = year;
    if (status)                    obj.status      = status;
    if (key_results)               obj.key_results = sanitizeKeyResults(key_results);

    await obj.save();

    res.json({ success: true, data: obj });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// DELETE /api/okr/:id  — Archive OKR (soft delete)
// ─────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    await OkrObjective.findByIdAndUpdate(req.params.id, { status: 'archived' });
    res.json({ success: true, message: 'OKR archived' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─────────────────────────────────────────────
// PATCH /api/okr/:id/update-kr-progress
// Called when employee submits self-assessment
// ─────────────────────────────────────────────
router.patch('/:id/update-kr-progress', async (req, res) => {
  try {
    const { kpi_item_id, actual_value } = req.body;

    const obj = await OkrObjective.findById(req.params.id);
    if (!obj) return res.status(404).json({ success: false, message: 'OKR not found' });

    const kr = obj.key_results.find(k => String(k.linked_kpi_item_id) === String(kpi_item_id));
    if (!kr) return res.status(404).json({ success: false, message: 'No Key Result linked to this KPI item' });

    kr.current_value = actual_value;
    await obj.save();

    res.json({ success: true, data: obj });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;