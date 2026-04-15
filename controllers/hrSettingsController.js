const HrShiftSettings = require("../models/HrShiftSettings");
const HrLeaveType     = require("../models/HrLeaveType");
const HrHoliday       = require("../models/HrHoliday");

// ── SHIFT ──────────────────────────────────────────
exports.getShift = async (req, res) => {
  try {
    const data = await HrShiftSettings.findOne();
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.saveShift = async (req, res) => {
  try {
    const data = await HrShiftSettings.findOneAndUpdate(
      {},
      { $set: req.body },
      { upsert: true, new: true }
    );
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── LEAVE TYPES ────────────────────────────────────
exports.getLeaveTypes = async (req, res) => {
  try {
    const data = await HrLeaveType.find().sort({ name: 1 });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.addLeaveType = async (req, res) => {
  try {
    const data = await HrLeaveType.create(req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.updateLeaveTypes = async (req, res) => {
  try {
    const { types } = req.body;
    await Promise.all(
      types.map(t => HrLeaveType.findByIdAndUpdate(t._id, { $set: t }))
    );
    res.json({ success: true, message: "Updated" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteLeaveType = async (req, res) => {
  try {
    await HrLeaveType.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Deleted" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── HOLIDAYS ───────────────────────────────────────
exports.getHolidays = async (req, res) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const data = await HrHoliday.find({
      date: {
        $gte: new Date(`${year}-01-01`),
        $lte: new Date(`${year}-12-31`),
      }
    }).sort({ date: 1 });
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.addHoliday = async (req, res) => {
  try {
    const data = await HrHoliday.create(req.body);
    res.json({ success: true, data });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

exports.deleteHoliday = async (req, res) => {
  try {
    await HrHoliday.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Deleted" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};