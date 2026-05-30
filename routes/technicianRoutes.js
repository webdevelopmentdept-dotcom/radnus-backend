const express = require("express");
const router  = express.Router();
const Technician    = require("../models/Technician");
const StatusHistory = require("../models/StatusHistory");

// ✅ NEW – CHECK 1: Mobile duplicate check
router.post("/check-mobile", async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.json({ exists: false });
    const exists = await Technician.findOne({ mobile: mobile.trim() });
    res.json({ exists: !!exists });
  } catch {
    res.status(500).json({ exists: false });
  }
});

// ✅ NEW – CHECK 2: fullName + district duplicate check
router.post("/check-duplicate", async (req, res) => {
  try {
    const { fullName, district } = req.body;
    if (!fullName || !district) return res.json({ exists: false });
    const exists = await Technician.findOne({
      fullName: new RegExp(`^${fullName.trim()}$`, "i"),
      district: new RegExp(`^${district.trim()}$`, "i"),
    });
    res.json({ exists: !!exists });
  } catch {
    res.status(500).json({ exists: false });
  }
});

// POST /api/technician
router.post("/", async (req, res) => {
  try {
    const tech = new Technician(req.body);
    await tech.save();
    res.status(201).json({ success: true, message: "Registration submitted" });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: "Mobile already registered" });
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// GET /api/technician/public  ← PUBLIC board
router.get("/public", async (req, res) => {
  try {
    const { district, experience, skill, search, page = 1, limit = 12 } = req.query;

    const filter = { availabilityStatus: "Available" };

    if (district)   filter.district = new RegExp(district, "i");
    if (experience) filter.experience = experience;
    if (skill)      filter.skills = { $elemMatch: { $regex: skill, $options: "i" } };
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { mobile:   new RegExp(search, "i") },
        { district: new RegExp(search, "i") },
        { skills:   { $elemMatch: { $regex: search, $options: "i" } } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [technicians, total] = await Promise.all([
      Technician.find(filter).sort({ featured: -1, createdAt: -1 }).skip(skip).limit(Number(limit)),
      Technician.countDocuments(filter),
    ]);

    res.json({ technicians, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    res.status(500).json({ technicians: [], total: 0, pages: 0 });
  }
});

// GET /api/technician  ← ADMIN list
router.get("/", async (req, res) => {
  try {
    const { status, district, experience, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status)     filter.availabilityStatus = status;
    if (district)   filter.district = new RegExp(district, "i");
    if (experience) filter.experience = experience;
    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { mobile:   new RegExp(search, "i") },
        { district: new RegExp(search, "i") },
        { skills:   { $elemMatch: { $regex: search, $options: "i" } } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [data, total] = await Promise.all([
      Technician.find(filter).sort({ featured: -1, createdAt: -1 }).skip(skip).limit(Number(limit)),
      Technician.countDocuments(filter),
    ]);

    res.json({ data, total, pages: Math.ceil(total / Number(limit)) });
  } catch {
    res.status(500).json({ success: false });
  }
});

// GET /api/technician/history/:id
router.get("/history/:id", async (req, res) => {
  try {
    const history = await StatusHistory.find({
      entityType: "technician",
      entityId:   req.params.id,
    }).sort({ changedAt: -1 });
    res.json(history);
  } catch {
    res.status(500).json({ success: false });
  }
});

// GET /api/technician/:id
router.get("/:id", async (req, res) => {
  try {
    const item = await Technician.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    res.json(item);
  } catch {
    res.status(400).json({ success: false });
  }
});

// PUT /api/technician/status/:id
router.put("/status/:id", async (req, res) => {
  try {
    const { status, changedBy = "admin", note = "" } = req.body;
    const prev = await Technician.findById(req.params.id);
    if (!prev) return res.status(404).json({ success: false, message: "Not found" });

    await Technician.findByIdAndUpdate(req.params.id, {
      availabilityStatus: status,
      status,
    });

    await StatusHistory.create({
      entityType: "technician",
      entityId:   req.params.id,
      fromStatus: prev.availabilityStatus || prev.status,
      toStatus:   status,
      changedBy,
      note,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// PUT /api/technician/:id
router.put("/:id", async (req, res) => {
  try {
    const updated = await Technician.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false });
  }
});

// PATCH /api/technician/featured/:id
router.patch("/featured/:id", async (req, res) => {
  try {
    const item = await Technician.findById(req.params.id);
    await Technician.findByIdAndUpdate(req.params.id, { featured: !item.featured });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// DELETE /api/technician/:id
router.delete("/:id", async (req, res) => {
  try {
    await Technician.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

module.exports = router;