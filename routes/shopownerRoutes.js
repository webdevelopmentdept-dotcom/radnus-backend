const express = require("express");
const router  = express.Router();
const ShopOwner     = require("../models/ShopOwner");
const StatusHistory = require("../models/StatusHistory");

/* ═══════════════════════════════════════════════
   HELPERS
═══════════════════════════════════════════════ */

const requiredFields = [
  "shopName", "ownerName", "mobile", "district", "taluk",
  "businessYears", "needTech", "jobType", "experience",
  "paymentType", "toolsSetup", "timeline", "radnusHire",
];

const isInvalid = (v) => {
  if (v === undefined || v === null) return true;
  if (typeof v === "string") {
    const s = v.trim();
    return s === "" || s === "-" || s === "--";
  }
  return false;
};

// Statuses where re-apply is NOT allowed
const BLOCKED_STATUSES = ["Pending", "Open", "In Process", "Archived"];

/* ═══════════════════════════════════════════════
   DUPLICATE CHECK ROUTES
═══════════════════════════════════════════════ */

// ✅ CHECK 1 – Mobile duplicate
router.post("/check-mobile", async (req, res) => {
  try {
    const { mobile } = req.body;
    if (!mobile) return res.json({ exists: false });

    const existing = await ShopOwner.findOne({ mobile: mobile.trim() });
    if (!existing) return res.json({ exists: false });

    const canReapply = !BLOCKED_STATUSES.includes(existing.jobStatus || existing.status);
    res.json({ exists: true, canReapply });
  } catch {
    res.status(500).json({ exists: false });
  }
});

// ✅ CHECK 2 – Shop Name + District duplicate
router.post("/check-duplicate", async (req, res) => {
  try {
    const { shopName, district } = req.body;
    if (!shopName || !district) return res.json({ exists: false });

    const existing = await ShopOwner.findOne({
      shopName: new RegExp(`^${shopName.trim()}$`, "i"),
      district: new RegExp(`^${district.trim()}$`, "i"),
    });
    if (!existing) return res.json({ exists: false });

    const canReapply = !BLOCKED_STATUSES.includes(existing.jobStatus || existing.status);
    res.json({ exists: true, canReapply });
  } catch {
    res.status(500).json({ exists: false });
  }
});

/* ═══════════════════════════════════════════════
   PUBLIC ROUTES
═══════════════════════════════════════════════ */

// POST /api/shop-owner — submit new requirement
router.post("/", async (req, res) => {
  try {
    for (const field of requiredFields) {
      if (isInvalid(req.body[field])) {
        return res.status(400).json({ success: false, message: `Invalid or missing: ${field}` });
      }
    }
    if (!Array.isArray(req.body.technicianTypes) || req.body.technicianTypes.length === 0)
      return res.status(400).json({ success: false, message: "At least one technician type required" });
    if (!Array.isArray(req.body.machines) || req.body.machines.length === 0)
      return res.status(400).json({ success: false, message: "At least one machine required" });

    // ✅ Check mobile — block if active status exists
    const existingMobile = await ShopOwner.findOne({ mobile: req.body.mobile.trim() });
    if (existingMobile) {
      const canReapply = !BLOCKED_STATUSES.includes(existingMobile.jobStatus || existingMobile.status);
      if (!canReapply)
        return res.status(409).json({ success: false, message: "Mobile number already registered" });
    }

    // ✅ Check shopName + district — block if active status exists
    const existingShop = await ShopOwner.findOne({
      shopName: new RegExp(`^${req.body.shopName.trim()}$`, "i"),
      district: new RegExp(`^${req.body.district.trim()}$`, "i"),
    });
    if (existingShop) {
      const canReapply = !BLOCKED_STATUSES.includes(existingShop.jobStatus || existingShop.status);
      if (!canReapply)
        return res.status(409).json({ success: false, message: "Shop already registered in this district" });
    }

    const newOwner = new ShopOwner(req.body);
    await newOwner.save();
    res.status(201).json({ success: true, message: "Requirement submitted successfully" });
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ success: false, message: "Mobile number already exists" });
    if (err.name === "ValidationError")
      return res.status(400).json({ success: false, message: err.message });
    res.status(500).json({ success: false, message: "Internal server error" });
  }
});

/* ═══════════════════════════════════════════════
   ADMIN ROUTES
═══════════════════════════════════════════════ */

// GET /api/shop-owner — all records (admin)
router.get("/", async (req, res) => {
  try {
    const { status, district, search, page = 1, limit = 50 } = req.query;

    const filter = {};
    if (status)   filter.jobStatus = status;
    if (district) filter.district  = new RegExp(district, "i");
    if (search) {
      filter.$or = [
        { shopName:  new RegExp(search, "i") },
        { ownerName: new RegExp(search, "i") },
        { mobile:    new RegExp(search, "i") },
        { district:  new RegExp(search, "i") },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [list, total] = await Promise.all([
      ShopOwner.find(filter).sort({ createdAt: -1 }).skip(skip).limit(Number(limit)),
      ShopOwner.countDocuments(filter),
    ]);

    res.json({ data: list, total, pages: Math.ceil(total / Number(limit)) });
  } catch {
    res.status(500).json({ success: false });
  }
});

// GET /api/shop-owner/:id — single record
router.get("/:id", async (req, res) => {
  try {
    const item = await ShopOwner.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    res.json(item);
  } catch {
    res.status(400).json({ success: false });
  }
});

// PUT /api/shop-owner/status/:id — update jobStatus + log history
router.put("/status/:id", async (req, res) => {
  try {
    const { status, changedBy = "admin", note = "" } = req.body;
    const prev = await ShopOwner.findById(req.params.id);
    if (!prev) return res.status(404).json({ success: false, message: "Not found" });

    await ShopOwner.findByIdAndUpdate(req.params.id, {
      jobStatus: status,
      status,
    });

    await StatusHistory.create({
      entityType: "shopowner",
      entityId:   req.params.id,
      fromStatus: prev.jobStatus || prev.status,
      toStatus:   status,
      changedBy,
      note,
    });

    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// PUT /api/shop-owner/:id — full update
router.put("/:id", async (req, res) => {
  try {
    const updated = await ShopOwner.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, data: updated });
  } catch {
    res.status(500).json({ success: false });
  }
});

// PATCH /api/shop-owner/featured/:id — toggle featured
router.patch("/featured/:id", async (req, res) => {
  try {
    const item = await ShopOwner.findById(req.params.id);
    await ShopOwner.findByIdAndUpdate(req.params.id, { featured: !item.featured });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// DELETE /api/shop-owner/:id — permanent delete
router.delete("/:id", async (req, res) => {
  try {
    await ShopOwner.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

// GET /api/shop-owner/history/:id — status audit trail
router.get("/history/:id", async (req, res) => {
  try {
    const history = await StatusHistory.find({
      entityType: "shopowner",
      entityId:   req.params.id,
    }).sort({ changedAt: -1 });
    res.json(history);
  } catch {
    res.status(500).json({ success: false });
  }
});

module.exports = router;