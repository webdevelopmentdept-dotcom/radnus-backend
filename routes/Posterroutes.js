const express = require("express");
const router  = express.Router();
const Poster  = require("../models/Poster");
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");

// ── Upload storage ─────────────────────────────
const uploadDir = path.join(__dirname, "../uploads/posters");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `poster_${Date.now()}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images allowed"));
  },
});

// ── GET all posters (admin) ───────────────────
router.get("/", async (req, res) => {
  try {
    const posters = await Poster.find().sort({ displayOrder: 1, createdAt: -1 });
    res.json(posters);
  } catch {
    res.status(500).json({ success: false });
  }
});

// ── POST upload new poster ─────────────────────
router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Image required" });
    const poster = new Poster({
      title:        req.body.title || "Hiring Poster",
      edition:      req.body.edition || "",
      imageUrl:     `/uploads/posters/${req.file.filename}`,
      displayOrder: Number(req.body.displayOrder) || 0,
    });
    await poster.save();
    res.status(201).json({ success: true, poster });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT update poster meta ─────────────────────
router.put("/:id", async (req, res) => {
  try {
    const updated = await Poster.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, poster: updated });
  } catch {
    res.status(500).json({ success: false });
  }
});

// ── DELETE poster ──────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const poster = await Poster.findById(req.params.id);
    if (!poster) return res.status(404).json({ success: false });

    // Delete file from disk
    const filePath = path.join(__dirname, "../", poster.imageUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await Poster.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch {
    res.status(500).json({ success: false });
  }
});

module.exports = router;