const express = require("express");
const router = express.Router();
const ShopOwner = require("../models/ShopOwner");

/* ================= HELPERS ================= */

const requiredFields = [
  "shopName",
  "ownerName",
  "mobile",
  "district",
  "taluk",
  "businessYears",
  "needTech",
  "jobType",
  "experience",
  "paymentType",
  "toolsSetup",
  "timeline",
  "radnusHire",
];

const isInvalidValue = (value) => {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") {
    const v = value.trim();
    return v === "" || v === "-" || v === "--";
  }
  return false;
};

/* ================= CREATE ================= */

router.post("/", async (req, res) => {
  try {
    console.log("🔥 SHOP OWNER BODY:", req.body);

    // Required fields
    for (const field of requiredFields) {
      if (isInvalidValue(req.body[field])) {
        return res.status(400).json({
          success: false,
          message: `Invalid or missing value for ${field}`,
        });
      }
    }

    // Arrays validation
    if (
      !Array.isArray(req.body.technicianTypes) ||
      req.body.technicianTypes.length === 0
    ) {
      return res.status(400).json({
        success: false,
        message: "At least one technician type is required",
      });
    }

    if (!Array.isArray(req.body.machines) || req.body.machines.length === 0) {
      return res.status(400).json({
        success: false,
        message: "At least one machine is required",
      });
    }

    // Duplicate mobile
    const existing = await ShopOwner.findOne({
      mobile: req.body.mobile,
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        message: "This mobile number is already submitted",
      });
    }

    // Save
    const newRequirement = new ShopOwner(req.body);
    await newRequirement.save();

    return res.status(201).json({
      success: true,
      message: "Shop owner requirement submitted successfully",
    });
  } catch (err) {
    console.error("❌ SHOP OWNER ERROR:", err);

    if (err.code === 11000) {
      return res.status(409).json({
        success: false,
        message: "Mobile number already exists",
      });
    }

    if (err.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        message: err.message,
      });
    }

    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/* ================= READ ================= */

router.get("/", async (req, res) => {
  try {
    const list = await ShopOwner.find().sort({ createdAt: -1 });
    res.json(list);
  } catch {
    res.status(500).json({ success: false });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const item = await ShopOwner.findById(req.params.id);
    if (!item) {
      return res.status(404).json({ success: false, message: "Not found" });
    }
    res.json(item);
  } catch {
    res.status(400).json({ success: false });
  }
});

/* ================= UPDATE ================= */

router.put("/status/:id", async (req, res) => {
  try {
    await ShopOwner.findByIdAndUpdate(req.params.id, {
      status: req.body.status,
    });
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

/* ================= DELETE ================= */

router.delete("/:id", async (req, res) => {
  try {
    await ShopOwner.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

module.exports = router;
