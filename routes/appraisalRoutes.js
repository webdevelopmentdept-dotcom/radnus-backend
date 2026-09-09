const express = require("express");
const router = express.Router();
const Appraisal = require("../models/Appraisal");
const PerformanceReview = require("../models/PerformanceReview");
const { computeRecognitionScore } = require("../helpers/recognitionScoreHelper");

// ═══════════════════════════════════════════════
// POST /api/appraisals — Create new appraisal
// ═══════════════════════════════════════════════
router.post("/", async (req, res) => {
  try {
    const {
      title,
      period_from,
      period_to,
      appraisal_type,
      employee_id,
      hr_rating,
      increment_percent,
      promotion,
      new_designation,
      remarks,
      status,
      created_by,
    } = req.body;

    // Auto-pull performance score from latest review
    let performance_score = 0;
    try {
      const latestReview = await PerformanceReview.findOne({ employee_id })
        .sort({ createdAt: -1 });

      if (latestReview) {
        performance_score =
          latestReview.final_score ||
          latestReview.score ||
          latestReview.total_score ||
          0;
      }
    } catch {
      // If PerformanceReview model doesn't exist yet, skip
    }

    // Auto-pull recognition score from Recognition Hub (announced awards in this period)
    let recognition_score = 0;
    let recognition_breakdown = undefined;
    try {
      const rec = await computeRecognitionScore(employee_id, period_from, period_to);
      recognition_score = rec.total;
      recognition_breakdown = rec.breakdown;
    } catch {
      // If EmployeeAward model doesn't exist yet, skip
    }

    const appraisal = new Appraisal({
      title,
      period_from,
      period_to,
      appraisal_type,
      employee_id,
      performance_score,
      recognition_score,
      recognition_breakdown,
      hr_rating,
      increment_percent,
      promotion,
      new_designation,
      remarks,
      status: status || "Draft",
      created_by,
    });

    await appraisal.save();

    res.status(201).json({ success: true, data: appraisal });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════
// PATCH /api/appraisals/:id/refresh-recognition
// Re-pull recognition score from Recognition Hub (in case
// awards were announced after this appraisal was created)
// ═══════════════════════════════════════════════
router.patch("/:id/refresh-recognition", async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.id);
    if (!appraisal) {
      return res.status(404).json({ success: false, message: "Appraisal not found" });
    }

    const rec = await computeRecognitionScore(
      appraisal.employee_id,
      appraisal.period_from,
      appraisal.period_to
    );

    appraisal.recognition_score = rec.total;
    appraisal.recognition_breakdown = rec.breakdown;
    await appraisal.save();

    const populated = await Appraisal.findById(appraisal._id)
      .populate("employee_id", "name email department designation");

    res.json({ success: true, data: populated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════
// GET /api/appraisals — Get all appraisals (HR)
// Query: ?status=Draft&employee_id=xxx
// ═══════════════════════════════════════════════
router.get("/", async (req, res) => {
  try {
    const filter = {};

    if (req.query.status)      filter.status      = req.query.status;
    if (req.query.employee_id) filter.employee_id = req.query.employee_id;
    if (req.query.appraisal_type) filter.appraisal_type = req.query.appraisal_type;

    const appraisals = await Appraisal.find(filter)
      .populate("employee_id", "name email department designation")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: appraisals, total: appraisals.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════
// GET /api/appraisals/employee/:employeeId
// Employee — தனக்கு வந்த published appraisals மட்டும்
// ═══════════════════════════════════════════════
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const appraisals = await Appraisal.find({
      employee_id: req.params.employeeId,
      status: "Published",
    })
      .populate("employee_id", "name email department designation")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: appraisals });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════
// GET /api/appraisals/:id — Single appraisal
// ═══════════════════════════════════════════════
router.get("/:id", async (req, res) => {
  try {
    const appraisal = await Appraisal.findById(req.params.id)
      .populate("employee_id", "name email department designation");

    if (!appraisal) {
      return res.status(404).json({ success: false, message: "Appraisal not found" });
    }

    res.json({ success: true, data: appraisal });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════
// PUT /api/appraisals/:id — Update appraisal
// ═══════════════════════════════════════════════
router.put("/:id", async (req, res) => {
  try {
    const appraisal = await Appraisal.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate("employee_id", "name email department designation");

    if (!appraisal) {
      return res.status(404).json({ success: false, message: "Appraisal not found" });
    }

    res.json({ success: true, data: appraisal });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════
// PATCH /api/appraisals/:id/publish — Publish appraisal
// Employee-க்கு visible ஆகும்
// ═══════════════════════════════════════════════
router.patch("/:id/publish", async (req, res) => {
  try {
    const appraisal = await Appraisal.findByIdAndUpdate(
      req.params.id,
      { status: "Published" },
      { new: true }
    ).populate("employee_id", "name email department designation");

    if (!appraisal) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.json({ success: true, data: appraisal, message: "Appraisal published successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════
// DELETE /api/appraisals/:id — Delete appraisal
// ═══════════════════════════════════════════════
router.delete("/:id", async (req, res) => {
  try {
    const appraisal = await Appraisal.findByIdAndDelete(req.params.id);

    if (!appraisal) {
      return res.status(404).json({ success: false, message: "Not found" });
    }

    res.json({ success: true, message: "Appraisal deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;