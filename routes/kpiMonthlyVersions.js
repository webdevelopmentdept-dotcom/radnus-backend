const express = require('express');
const router = express.Router();
const KpiMonthlyVersion = require('../models/KpiMonthlyVersion');
const KpiTemplate = require('../models/KpiTemplate');

// GET /api/kpi-monthly-versions?template_id=xxx
router.get('/', async (req, res) => {
  try {
    const { template_id } = req.query;
    if (!template_id) {
      return res.status(400).json({ success: false, message: 'template_id required' });
    }
    const versions = await KpiMonthlyVersion.find({ template_id })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: versions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/kpi-monthly-versions - Create new month version
router.post('/', async (req, res) => {
  try {
    const { template_id, month, copy_from_month } = req.body;
    
    if (!template_id || !month) {
      return res.status(400).json({ 
        success: false, 
        message: 'template_id and month are required' 
      });
    }
    
    // Check if exists
    const existing = await KpiMonthlyVersion.findOne({ template_id, month });
    if (existing) {
      return res.status(400).json({ 
        success: false, 
        message: 'Version already exists for this month' 
      });
    }
    
    let kpiItems = [];
    let totalWeight = 0;
    
    if (copy_from_month) {
      // Copy from previous month version
      const prev = await KpiMonthlyVersion.findOne({ template_id, month: copy_from_month });
      if (prev) {
        kpiItems = JSON.parse(JSON.stringify(prev.kpi_items));
        totalWeight = prev.total_weight || 0;
      }
    }
    
    // If no copy_from or previous not found, copy from template default
    if (kpiItems.length === 0) {
      const template = await KpiTemplate.findById(template_id);
      if (template && template.kpi_items) {
        kpiItems = JSON.parse(JSON.stringify(template.kpi_items));
        totalWeight = kpiItems.reduce((s, i) => s + (parseFloat(i.weight) || 0), 0);
      }
    }
    
    const version = new KpiMonthlyVersion({
      template_id,
      month,
      month_status: 'active',
      kpi_items: kpiItems,
      total_weight: totalWeight
    });
    
    await version.save();
    res.status(201).json({ success: true, data: version });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PUT /api/kpi-monthly-versions/:id - Edit month version
// PUT /api/kpi-monthly-versions/:id - Edit month version
router.put('/:id', async (req, res) => {
  try {
    const version = await KpiMonthlyVersion.findById(req.params.id);
    if (!version) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    
    if (version.month_status === 'locked') {
      return res.status(400).json({ 
        success: false, 
        message: 'This month is locked and cannot be edited' 
      });
    }
    
    // ✅ NEW: Validate total weight if kpi_items provided
    if (req.body.kpi_items) {
      const totalWeight = req.body.kpi_items.reduce((s, i) => s + (parseFloat(i.weight) || 0), 0);
      if (totalWeight !== 100) {
        return res.status(400).json({
          success: false,
          message: `Total weight must be 100%. Current: ${totalWeight}%`
        });
      }
      req.body.total_weight = totalWeight;
    }
    
    const updated = await KpiMonthlyVersion.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );
    
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE /api/kpi-monthly-versions/:id
router.delete('/:id', async (req, res) => {
  try {
    const version = await KpiMonthlyVersion.findById(req.params.id);
    if (!version) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    
    if (version.month_status === 'locked') {
      return res.status(400).json({ 
        success: false, 
        message: 'Locked versions cannot be deleted' 
      });
    }
    
    await KpiMonthlyVersion.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// POST /api/kpi-monthly-versions/:id/lock
router.post('/:id/lock', async (req, res) => {
  try {
    const updated = await KpiMonthlyVersion.findByIdAndUpdate(
      req.params.id,
      { month_status: 'locked', locked_at: new Date() },
      { new: true }
    );
    if (!updated) {
      return res.status(404).json({ success: false, message: 'Not found' });
    }
    res.json({ success: true, data: updated });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;