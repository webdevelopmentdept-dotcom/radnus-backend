const express  = require("express");
const router   = express.Router();
const multer   = require("multer");
const path     = require("path");
const fs       = require("fs");
const SOP      = require("../models/Sop");

// ── Multer Storage — saves to /uploads/sops/ ──────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, "../uploads/sops");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    // e.g. 1714201234567-Finance-SOP.docx
    const safeName = file.originalname.replace(/\s+/g, "-");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = [
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error("Only .doc and .docx files are allowed"), false);
  }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB max


// ══════════════════════════════════════════════════════
//  HR ADMIN ROUTES
// ══════════════════════════════════════════════════════

// ── GET /api/sops — get all SOPs (HR Admin) ───────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.department)  filter.department  = req.query.department;
    if (req.query.designation) filter.designation = req.query.designation;
    if (req.query.status)      filter.status      = req.query.status;

    const sops = await SOP.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: sops });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── POST /api/sops — create SOP with file upload ─────────────────────────────
router.post("/", upload.single("file"), async (req, res) => {
  try {
    const { title, department, designation, status } = req.body;

    if (!title || !department) {
      return res.status(400).json({ success: false, message: "Title and Department are required" });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: "A .doc or .docx file is required" });
    }

    const sop = await SOP.create({
      title:       title.trim(),
      department:  department.trim(),
      designation: designation?.trim() || null,  // null = dept-level
      fileUrl:     req.file.filename,
      fileName:    req.file.originalname,
      status:      status || "active",
    });

    res.status(201).json({ success: true, data: sop, message: "SOP created successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── PUT /api/sops/:id — update SOP (replace file optional) ───────────────────
router.put("/:id", upload.single("file"), async (req, res) => {
  try {
    const { title, department, designation, status } = req.body;

    const existing = await SOP.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "SOP not found" });

    const updateData = {
      title:       title?.trim()       || existing.title,
      department:  department?.trim()  || existing.department,
      designation: designation?.trim() || null,
      status:      status              || existing.status,
    };

    // If new file uploaded — delete old file, save new one
    if (req.file) {
      const oldPath = path.join(__dirname, "../uploads/sops", existing.fileUrl);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);

      updateData.fileUrl  = req.file.filename;
      updateData.fileName = req.file.originalname;
    }

    const sop = await SOP.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ success: true, data: sop, message: "SOP updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── PATCH /api/sops/:id/status — toggle active/inactive ──────────────────────
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "inactive"].includes(status))
      return res.status(400).json({ success: false, message: "Invalid status" });

    const sop = await SOP.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!sop) return res.status(404).json({ success: false, message: "SOP not found" });

    res.json({ success: true, data: sop, message: `SOP marked ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── DELETE /api/sops/:id — delete SOP + file ─────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    const sop = await SOP.findById(req.params.id);
    if (!sop) return res.status(404).json({ success: false, message: "SOP not found" });

    // Delete file from disk
    const filePath = path.join(__dirname, "../uploads/sops", sop.fileUrl);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

    await SOP.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "SOP deleted permanently" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  EMPLOYEE ROUTE — fetch SOPs for logged-in employee
// ══════════════════════════════════════════════════════

// ── GET /api/sops/my — employee sees dept + designation SOPs ─────────────────
// Query params: ?department=Accounts & Finance Department&designation=Accountant
router.get("/my", async (req, res) => {
  try {
    const { department, designation } = req.query;

    if (!department) {
      return res.status(400).json({ success: false, message: "Department is required" });
    }

    // Fetch dept-level SOPs (designation: null) + designation-level SOPs
    const sops = await SOP.find({
      department,
      status: "active",
      $or: [
        { designation: null },                            // dept-level — all roles see
        { designation: designation || "__none__" },       // role-specific
      ],
    }).sort({ designation: 1, createdAt: -1 });

    res.json({ success: true, data: sops });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ── GET /api/sops/download/:filename — serve the .docx file ──────────────────
router.get("/download/:filename", (req, res) => {
  const filePath = path.join(__dirname, "../uploads/sops", req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: "File not found" });
  }
  res.download(filePath);
});


module.exports = router;