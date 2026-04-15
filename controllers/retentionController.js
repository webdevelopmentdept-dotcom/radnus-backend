const RetentionPlan = require("../models/RetentionPlan");
const Employee      = require("../models/Employee");
const { createNotification } = require("../helpers/notificationHelper"); // ✅ ADD THIS

const autoEnrollLeadershipTrack = async (employeeId) => {
  const emp = await Employee.findById(employeeId);
  if (!emp || emp.leadershipTrack?.stage) return;
  await Employee.findByIdAndUpdate(employeeId, {
    $set: {
      "leadershipTrack.stage":          1,
      "leadershipTrack.stageLabel":     "Emerging Leader",
      "leadershipTrack.targetRole":     "Senior Executive → Assistant Manager",
      "leadershipTrack.timeline":       "1–2 years",
      "leadershipTrack.focusAreas":     ["Operational excellence","Team handling","OKR ownership"],
      "leadershipTrack.expectedOutput": "Readiness for first managerial role",
      "leadershipTrack.isHiPo":         false,
      "leadershipTrack.enrolledAt":     new Date(),
    }
  });
};

const createPlan = async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId)
      return res.status(400).json({ success: false, message: "employeeId required" });

    const exists = await RetentionPlan.findOne({ employeeId });
    if (exists)
      return res.status(409).json({ success: false, message: "Plan already exists. Use PUT to update." });

    const emp = await Employee.findById(employeeId);
    if (!emp)
      return res.status(404).json({ success: false, message: "Employee not found" });

    const plan = await RetentionPlan.create({ ...req.body });

    if (["active", "under_review"].includes(req.body.status))
      await autoEnrollLeadershipTrack(employeeId);

    await plan.populate("employeeId", "name department designation");

    // ✅ Notify employee — Retention Plan created
    await createNotification({
      recipient_id:   employeeId,
      recipient_role: "employee",
      type:           "hr",
      title:          "Retention Plan Created 📋",
      message:        `HR has created a retention plan for you. Status: ${req.body.status || "draft"}. Check your profile for details.`,
      link:           "/employee/my-profile"
    });

    res.status(201).json({ success: true, data: plan, message: "Retention plan created" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getAllPlans = async (req, res) => {
  try {
    const plans = await RetentionPlan.find()
      .populate("employeeId", "name department designation leadershipTrack")
      .sort({ updatedAt: -1 });
    res.json({ success: true, data: plans });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const getPlanByEmployee = async (req, res) => {
  try {
    const plan = await RetentionPlan.findOne({ employeeId: req.params.employeeId })
      .populate("employeeId", "name department designation leadershipTrack");
    if (!plan)
      return res.status(404).json({ success: false, message: "No retention plan found" });
    res.json({ success: true, data: plan });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const updatePlan = async (req, res) => {
  try {
    if (req.body.status === "active" && !req.body.approvedAt)
      req.body.approvedAt = new Date();

    const plan = await RetentionPlan.findByIdAndUpdate(
      req.params.id, req.body, { new: true, runValidators: true }
    ).populate("employeeId", "name department designation");

    if (!plan)
      return res.status(404).json({ success: false, message: "Plan not found" });

    if (["active", "under_review"].includes(req.body.status) && plan.employeeId?._id)
      await autoEnrollLeadershipTrack(plan.employeeId._id);

    // ✅ Notify employee — Retention Plan updated
    // Status-க்கு வெவ்வேறு message
    const statusMessages = {
      active:       "Your retention plan has been approved and is now active! 🎉",
      under_review: "Your retention plan is currently under review by HR.",
      completed:    "Your retention plan has been marked as completed. ✅",
      cancelled:    "Your retention plan has been cancelled by HR.",
      draft:        "Your retention plan has been updated by HR.",
    };

    const msg = statusMessages[req.body.status] || "Your retention plan has been updated by HR.";

    if (plan.employeeId?._id) {
      await createNotification({
        recipient_id:   plan.employeeId._id,
        recipient_role: "employee",
        type:           "hr",
        title:          "Retention Plan Updated 🔄",
        message:        msg,
        link:           "/employee/my-profile"
      });
    }

    res.json({ success: true, data: plan, message: "Plan updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

const addReview = async (req, res) => {
  try {
    const { reviewedBy, outcome, notes } = req.body;

    const plan = await RetentionPlan.findByIdAndUpdate(
      req.params.id,
      { $push: { reviewHistory: { date: new Date(), reviewedBy, outcome, notes } } },
      { new: true }
    ).populate("employeeId", "name department");

    if (!plan)
      return res.status(404).json({ success: false, message: "Plan not found" });

    // ✅ Notify employee — Retention Plan reviewed
    const outcomeMessages = {
      positive:  "Great news! Your retention review outcome is positive. 👍",
      neutral:   "Your retention plan review has been completed.",
      negative:  "Your retention plan review has been completed. Please connect with HR.",
      escalated: "Your retention plan has been escalated for further review.",
    };

    const msg = outcomeMessages[outcome] || "Your retention plan has been reviewed by HR.";

    if (plan.employeeId?._id) {
      await createNotification({
        recipient_id:   plan.employeeId._id,
        recipient_role: "employee",
        type:           "hr",
        title:          "Retention Plan Reviewed 📝",
        message:        `${msg}${notes ? ` Note: ${notes}` : ""}`,
        link:           "/employee/my-profile"
      });
    }

    res.json({ success: true, data: plan, message: "Review logged" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// DELETE plan
const deletePlan = async (req, res) => {
  try {
    const plan = await RetentionPlan.findByIdAndDelete(req.params.id);
    if (!plan) {
      return res.status(404).json({ success: false, message: "Plan not found" });
    }
    res.json({ success: true, message: "Retention plan deleted successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = { createPlan, getPlanByEmployee, getAllPlans, updatePlan, addReview, deletePlan };