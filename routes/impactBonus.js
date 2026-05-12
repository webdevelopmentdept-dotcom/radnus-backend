const express = require('express');
const router  = express.Router();
const ImpactBonus = require('../models/ImpactBonus');
const { createNotification } = require('../helpers/notificationHelper');

const TIER_CONFIG = {
  tier1_local:    { label:'Local Impact',          min:5000,   max:15000  },
  tier2_cross:    { label:'Cross-functional',      min:25000,  max:50000  },
  tier3_company:  { label:'Company-Wide Impact',   min:100000, max:200000 },
};

const SCORING_CRITERIA = {
  innovation_originality:     { label:'Innovation / Originality',              max:25 },
  measurable_business_result: { label:'Measurable Business Result',            max:35 },
  scalability:                { label:'Scalability',                           max:20 },
  team_collaboration_speed:   { label:'Team Collaboration & Implementation',   max:20 },
};

// GET all submissions
router.get('/', async (req, res) => {
  try {
    const { status, impact_tier, period } = req.query;
    const filter = {};
    if (status)      filter.status      = status;
    if (impact_tier) filter.impact_tier = impact_tier;
    if (period)      filter.period      = period;

    const submissions = await ImpactBonus.find(filter)
      .populate('employee_id', 'name email department designation')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: submissions });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET summary stats
router.get('/summary', async (req, res) => {
  try {
    const [total, submitted, approved, announced] = await Promise.all([
      ImpactBonus.countDocuments(),
      ImpactBonus.countDocuments({ status: 'submitted' }),
      ImpactBonus.countDocuments({ status: { $in: ['approved', 'announced'] } }),
      ImpactBonus.countDocuments({ status: 'announced' }),
    ]);

    const tierCounts = await Promise.all(
      Object.keys(TIER_CONFIG).map(async t => ({
        tier: t,
        count: await ImpactBonus.countDocuments({ impact_tier: t })
      }))
    );

    const totalBonus = await ImpactBonus.aggregate([
      { $match: { status: 'announced' } },
      { $group: { _id: null, total: { $sum: '$bonus_amount' } } }
    ]);

    res.json({
      success: true,
      data: {
        total, submitted, approved, announced,
        tier_counts: tierCounts,
        total_bonus_paid: totalBonus[0]?.total || 0
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ FIXED — GET all announced innovations as announcements
router.get('/announcements', async (req, res) => {
  try {
  const announced = await ImpactBonus.find({ status: 'announced' })
  .populate('employee_id', 'name department')
  .sort({ announced_at: -1 })
  .limit(10);

// ✅ employee_id populate ஆகலன்னா filter பண்ணிடு
const data = announced
  .filter(s => s.employee_id && s.employee_id.name)
  .map(s => ({ 
      _id:           s._id,
      title:         s.title,                          // ✅ innovation title மட்டும்
      employee_name: s.employee_id?.name || '',        // ✅ separate field
      department:    s.employee_id?.department || '',  // ✅ separate field
      bonus_amount:  s.bonus_amount,
      total_score:   s.total_score,
      message:       `${s.employee_id?.department || ''} · Bonus: ₹${s.bonus_amount?.toLocaleString('en-IN')} · Score: ${s.total_score}/100`,
      createdAt:     s.announced_at || s.updatedAt,
      type:          'impact_bonus',
    }));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET employee submissions
router.get('/employee/:employeeId', async (req, res) => {
  try {
    const data = await ImpactBonus.find({ employee_id: req.params.employeeId })
      .sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST submit idea
router.post('/', async (req, res) => {
  try {
    const {
      employee_id, title, description, impact_areas,
      submission_channel, employee_level, contribution_type,
      impact_tier, period
    } = req.body;

    if (!employee_id || !title || !description) {
      return res.status(400).json({
        success: false,
        message: 'employee_id, title, description required'
      });
    }

    const submission = new ImpactBonus({
      employee_id, title, description, impact_areas,
      submission_channel, employee_level, contribution_type,
      impact_tier: impact_tier || 'tier1_local', period,
      status: 'submitted'
    });
    await submission.save();

    await createNotification({
      recipient_id:   employee_id,
      recipient_role: 'employee',
      type:           'hr',
      title:          '💡 Impact Bonus Submitted!',
      message:        `Your innovation "${title}" has been submitted for review.`,
      link:           '/employee/dashboard'
    });

    res.status(201).json({ success: true, data: submission });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// PATCH update status + scoring
router.patch('/:id/status', async (req, res) => {
  try {
    const {
      status, scoring, bonus_amount, impact_tier,
      dept_head_comment, iec_comment, rejection_reason,
      certificate_issued, featured_in_digest, esop_eligible,
      impact_wall, approved_by
    } = req.body;

    const sub = await ImpactBonus.findById(req.params.id)
      .populate('employee_id', 'name email department');
    if (!sub) return res.status(404).json({ success: false, message: 'Not found' });

    sub.status = status;
    if (scoring)           sub.scoring           = scoring;
    if (bonus_amount)      sub.bonus_amount       = bonus_amount;
    if (impact_tier)       sub.impact_tier        = impact_tier;
    if (dept_head_comment) sub.dept_head_comment  = dept_head_comment;
    if (iec_comment)       sub.iec_comment        = iec_comment;
    if (rejection_reason)  sub.rejection_reason   = rejection_reason;
    if (approved_by)       sub.approved_by        = approved_by;

    if (certificate_issued !== undefined) sub.certificate_issued = certificate_issued;
    if (featured_in_digest !== undefined) sub.featured_in_digest = featured_in_digest;
    if (esop_eligible !== undefined)      sub.esop_eligible      = esop_eligible;
    if (impact_wall !== undefined)        sub.impact_wall        = impact_wall;

    if (status === 'approved') sub.bonus_approved = true;
    if (status === 'announced') sub.announced_at  = new Date();

    await sub.save();

    const notifyStatuses = {
      dept_review: `Your innovation "${sub.title}" is under Department Head review.`,
      approved:    `🎉 Your innovation "${sub.title}" is APPROVED! Bonus: ₹${sub.bonus_amount?.toLocaleString('en-IN')}`,
      announced:   `🏆 Congratulations! "${sub.title}" featured on Radnus Impact Wall!`,
      rejected:    `Your submission "${sub.title}" was not selected. Reason: ${rejection_reason || 'See HR for details'}`,
    };

    if (notifyStatuses[status]) {
      await createNotification({
        recipient_id:   sub.employee_id._id,
        recipient_role: 'employee',
        type:           'hr',
        title:          'Impact Bonus Update',
        message:        notifyStatuses[status],
        link:           '/employee/dashboard'
      });
    }

    res.json({ success: true, data: sub });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// DELETE
router.delete('/:id', async (req, res) => {
  try {
    await ImpactBonus.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;