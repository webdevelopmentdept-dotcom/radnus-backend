// routes/recognitionConfig.js  points per award type and the appraisal cap. HR, MD and admin can change.
const express = require('express');
const router = express.Router();
const RecognitionConfig = require('../models/RecognitionConfig');
const { getRecognitionConfig } = require('../helpers/recognitionConfig');
const auth = require('../middleware/auth');
const hrOnly = require('../middleware/hrOnly');

router.use(auth, hrOnly);   // hrOnly already lets HR and admin in

router.get('/', async (req, res) => {
  try {
    const cfg = await getRecognitionConfig();
    res.json({ success: true, data: cfg, can_edit: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

router.put('/', async (req, res) => {
  try {
    const b = req.body || {};
    const lp = b.legacy_points || {};
    const set = {};
    for (const k of ['spot', 'monthly_star', 'innovation']) {
      const v = Math.floor(Number(lp[k]));
      if (!Number.isFinite(v) || v < 0 || v > 100) return res.status(400).json({ success: false, message: 'Each award type must be between 0 and 100 points' });
      set[`legacy_points.${k}`] = v;
    }
    const cap = Math.floor(Number(b.cap_points));
    if (!Number.isFinite(cap) || cap < 0 || cap > 500) return res.status(400).json({ success: false, message: 'The cap must be between 0 and 500 (0 means no cap)' });
    set.cap_points = cap;
    set.updated_by_name = req.user?.name || req.user?.email || '';
    await getRecognitionConfig();                                   // make sure the document exists
    const cfg = await RecognitionConfig.findOneAndUpdate({ key: 'main' }, { $set: set }, { new: true }).lean();
    res.json({ success: true, data: cfg, can_edit: true });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
});

module.exports = router;