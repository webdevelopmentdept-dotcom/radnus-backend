const LeadershipTrack = require("../models/LeadershipTrack");
const Employee        = require("../models/Employee");

// Stage config
const STAGE_CONFIG = {
  1: { label:"Emerging Leader",   targetRole:"Senior Executive → Assistant Manager", timeline:"1–2 years", focusAreas:["Operational excellence","Team handling","OKR ownership"],                         expectedOutput:"Readiness for first managerial role" },
  2: { label:"Managerial Leader",  targetRole:"Manager → Senior Manager",             timeline:"2–3 years", focusAreas:["Strategic planning","Project ownership","Mentoring"],                             expectedOutput:"Lead small to mid-sized teams" },
  3: { label:"Business Leader",   targetRole:"GM → AVP",                             timeline:"3–5 years", focusAreas:["Cross-functional leadership","Financial acumen","Stakeholder management"],       expectedOutput:"Drive department-level business outcomes" },
  4: { label:"Strategic Leader",  targetRole:"VP → Director",                        timeline:"3–5 years", focusAreas:["Company-wide impact","Innovation","Culture building"],                           expectedOutput:"Lead multiple functions or geographies" },
  5: { label:"Executive / CXO",   targetRole:"CXO",                                  timeline:"2–4 years", focusAreas:["Visionary leadership","Board-level decision making"],                            expectedOutput:"Guide Radnus strategic growth and sustainability" },
};

// ── POST /api/leadership-track ─────────────────────────────────
const enrollEmployee = async (req, res) => {
  try {
    const { employeeId, stage = 1, isHiPo = false, mentor, hrNotes } = req.body;
    if (!employeeId)
      return res.status(400).json({ success:false, message:"employeeId required" });

    const exists = await LeadershipTrack.findOne({ employeeId });
    if (exists)
      return res.status(409).json({ success:false, message:"Employee already enrolled. Use PUT to update." });

    const emp = await Employee.findById(employeeId);
    if (!emp)
      return res.status(404).json({ success:false, message:"Employee not found" });

    const cfg = STAGE_CONFIG[stage] || STAGE_CONFIG[1];

    const track = await LeadershipTrack.create({
      employeeId,
      stage,
      stageLabel:     cfg.label,
      targetRole:     cfg.targetRole,
      timeline:       cfg.timeline,
      focusAreas:     cfg.focusAreas,
      expectedOutput: cfg.expectedOutput,
      isHiPo,
      mentor:         mentor || {},
      hrNotes:        hrNotes || "",
      enrolledAt:     new Date(),
      progressHistory:[{ updatedBy:"HR", notes:`Enrolled at Stage ${stage} — ${cfg.label}`, stageChanged:false }],
    });

    // ✅ Employee model-ல leadershipTrack field sync
    await Employee.findByIdAndUpdate(employeeId, {
      $set: {
        "leadershipTrack.stage":          stage,
        "leadershipTrack.stageLabel":     cfg.label,
        "leadershipTrack.targetRole":     cfg.targetRole,
        "leadershipTrack.timeline":       cfg.timeline,
        "leadershipTrack.focusAreas":     cfg.focusAreas,
        "leadershipTrack.expectedOutput": cfg.expectedOutput,
        "leadershipTrack.isHiPo":         isHiPo,
        "leadershipTrack.enrolledAt":     new Date(),
      }
    });

    await track.populate("employeeId","name department designation");
    res.status(201).json({ success:true, data:track, message:"Employee enrolled in Leadership Track" });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
};

// ── GET /api/leadership-track ─────────────────────────────────
const getAllTracks = async (req, res) => {
  try {
    const tracks = await LeadershipTrack.find()
      .populate("employeeId","name department designation")
      .sort({ updatedAt:-1 });
    res.json({ success:true, data:tracks });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
};

// ── GET /api/leadership-track/:employeeId ─────────────────────
const getTrackByEmployee = async (req, res) => {
  try {
    const track = await LeadershipTrack.findOne({ employeeId:req.params.employeeId })
      .populate("employeeId","name department designation");
    if (!track)
      return res.status(404).json({ success:false, message:"No track found" });
    res.json({ success:true, data:track });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
};

// ── PUT /api/leadership-track/:id ─────────────────────────────
const updateTrack = async (req, res) => {
  try {
    const existing = await LeadershipTrack.findById(req.params.id);
    if (!existing)
      return res.status(404).json({ success:false, message:"Track not found" });

    const stageChanged = req.body.stage && req.body.stage !== existing.stage;
    const newStage     = req.body.stage || existing.stage;
    const cfg          = STAGE_CONFIG[newStage] || STAGE_CONFIG[1];

    // Auto-fill stage info if stage changed
    if (stageChanged) {
      req.body.stageLabel     = cfg.label;
      req.body.targetRole     = cfg.targetRole;
      req.body.timeline       = cfg.timeline;
      req.body.focusAreas     = cfg.focusAreas;
      req.body.expectedOutput = cfg.expectedOutput;
    }

    // Push progress history
    const historyEntry = {
      date:         new Date(),
      updatedBy:    req.body.updatedBy || "HR",
      stageChanged,
      fromStage:    stageChanged ? existing.stage : undefined,
      toStage:      stageChanged ? newStage        : undefined,
      notes:        req.body.progressNote || (stageChanged ? `Stage updated ${existing.stage} → ${newStage}` : "Plan updated"),
    };

    const track = await LeadershipTrack.findByIdAndUpdate(
      req.params.id,
      {
        ...req.body,
        $push:{ progressHistory: historyEntry },
      },
      { new:true, runValidators:true }
    ).populate("employeeId","name department designation");

    // ✅ Employee model sync
    if (stageChanged && track.employeeId?._id) {
      await Employee.findByIdAndUpdate(track.employeeId._id, {
        $set: {
          "leadershipTrack.stage":          newStage,
          "leadershipTrack.stageLabel":     cfg.label,
          "leadershipTrack.targetRole":     cfg.targetRole,
          "leadershipTrack.timeline":       cfg.timeline,
          "leadershipTrack.focusAreas":     cfg.focusAreas,
          "leadershipTrack.expectedOutput": cfg.expectedOutput,
        }
      });
    }

    res.json({ success:true, data:track, message:"Track updated" });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
};

// ── DELETE /api/leadership-track/:id ─────────────────────────
const withdrawTrack = async (req, res) => {
  try {
    const track = await LeadershipTrack.findByIdAndUpdate(
      req.params.id,
      { status:"withdrawn", $push:{ progressHistory:{ updatedBy:"HR", notes:"Withdrawn from Leadership Track", stageChanged:false } } },
      { new:true }
    );
    if (!track)
      return res.status(404).json({ success:false, message:"Track not found" });
    res.json({ success:true, message:"Employee withdrawn from track" });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
};

module.exports = { enrollEmployee, getAllTracks, getTrackByEmployee, updateTrack, withdrawTrack };