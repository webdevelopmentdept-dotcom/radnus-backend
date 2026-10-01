const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const path    = require("path");
const fs      = require("fs");
const HrInduction = require("../models/Hrinduction");

const UPLOAD_DIR = path.join(__dirname, "../uploads/hr-induction");

// ── Multer — PDF only, 10MB ───────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "-");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const fileFilter = (req, file, cb) => {
  const isPdf =
    file.mimetype === "application/pdf" &&
    file.originalname.toLowerCase().endsWith(".pdf");
  isPdf ? cb(null, true) : cb(new Error("Only PDF files are allowed"), false);
};

const uploader = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } });

// Wrapper so multer errors come back as JSON (not an HTML error page)
const uploadPdf = (req, res, next) => {
  uploader.single("file")(req, res, (err) => {
    if (err) {
      const message = err.code === "LIMIT_FILE_SIZE" ? "PDF must be 10MB or smaller" : err.message;
      return res.status(400).json({ success: false, message });
    }
    next();
  });
};

const removeFile = (filename) => {
  if (!filename) return;
  const p = path.join(UPLOAD_DIR, path.basename(filename));
  if (fs.existsSync(p)) fs.unlinkSync(p);
};

// ══════════════════════════════════════════════════════
//  EMPLOYEE ROUTES  (declared first so they are never shadowed)
// ══════════════════════════════════════════════════════

// GET /api/hr-induction/my — active inductions for every employee
router.get("/my", async (req, res) => {
  try {
    const data = await HrInduction.find({ status: "active" }).sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/hr-induction/view/:filename — streams the PDF INLINE (view only)
router.get("/view/:filename", (req, res) => {
  const filePath = path.join(UPLOAD_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found" });
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "inline");
  res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
  fs.createReadStream(filePath).pipe(res);
});

// ══════════════════════════════════════════════════════
//  HR ROUTES
// ══════════════════════════════════════════════════════

// GET /api/hr-induction — all (HR)
router.get("/", async (req, res) => {
  try {
    const data = await HrInduction.find().sort({ createdAt: -1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/hr-induction — create (title + description + PDF)
router.post("/", uploadPdf, async (req, res) => {
  try {
    const { title, description, status } = req.body;
    if (!title || !title.trim()) {
      removeFile(req.file?.filename);
      return res.status(400).json({ success: false, message: "Title is required" });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "A PDF file is required" });
    }

    const doc = await HrInduction.create({
      title:       title.trim(),
      description: (description || "").trim(),
      fileUrl:     req.file.filename,
      fileName:    req.file.originalname,
      status:      status || "active",
    });
    res.status(201).json({ success: true, data: doc, message: "HR Induction added" });
  } catch (err) {
    removeFile(req.file?.filename);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/hr-induction/:id — update (PDF optional)
router.put("/:id", uploadPdf, async (req, res) => {
  try {
    const existing = await HrInduction.findById(req.params.id);
    if (!existing) {
      removeFile(req.file?.filename);
      return res.status(404).json({ success: false, message: "Not found" });
    }

    const { title, description, status } = req.body;
    const update = {
      title:       title?.trim() || existing.title,
      description: description !== undefined ? description.trim() : existing.description,
      status:      status || existing.status,
    };

    if (req.file) {
      removeFile(existing.fileUrl);
      update.fileUrl  = req.file.filename;
      update.fileName = req.file.originalname;
    }

    const doc = await HrInduction.findByIdAndUpdate(req.params.id, update, { new: true });
    res.json({ success: true, data: doc, message: "HR Induction updated" });
  } catch (err) {
    removeFile(req.file?.filename);
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/hr-induction/:id/status — toggle active / inactive
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const doc = await HrInduction.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/hr-induction/:id — delete record + file
router.delete("/:id", async (req, res) => {
  try {
    const doc = await HrInduction.findById(req.params.id);
    if (!doc) return res.status(404).json({ success: false, message: "Not found" });
    removeFile(doc.fileUrl);
    await HrInduction.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;