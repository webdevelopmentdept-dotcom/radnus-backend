const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const EmploymentDetails = require("../models/EmploymentDetails");
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const { createNotification } = require("../helpers/notificationHelper"); // ✅ added

// ================= CLOUDINARY STORAGE =================
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: "hr-documents",
      resource_type: "auto",
      public_id: Date.now() + "-" + file.originalname,
    };
  },
});

// ================= MULTER =================
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg", "image/png", "image/jpg",
      "application/pdf", "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type: " + file.mimetype), false);
    }
  },
});

// ================= UPLOAD HR DOCUMENT =================
router.post("/upload-doc", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }
    try {
      const { employeeId, docType } = req.body;

      if (!employeeId)
        return res.status(400).json({ success: false, message: "EMPLOYEE_ID_MISSING" });

      if (!req.file)
        return res.status(400).json({ success: false, message: "NO_FILE_UPLOADED" });

      const existingDoc = await Document.findOne({ employeeId, docType });
      if (existingDoc) {
        existingDoc.fileUrl = req.file.path;
        existingDoc.publicId = req.file.filename;
        await existingDoc.save();
        return res.json({ success: true, message: "Document updated", fileUrl: req.file.path });
      }

      const newDoc = new Document({
        employeeId, docType,
        fileUrl: req.file.path,
        publicId: req.file.filename,
      });
      await newDoc.save();

      res.json({ success: true, message: "Uploaded successfully", fileUrl: req.file.path });
    } catch (err) {
      res.status(500).json({ success: false, message: "Upload failed" });
    }
  });
});

// ================= GET HR DOCUMENTS =================
router.get("/docs/:employeeId", async (req, res) => {
  try {
    const hrDocTypes = [
      "Offer Letter", "Appointment Letter", "NDA Agreement",
      "Employment Contract", "Salary Structure Document", "HR Policy Document",
    ];
    const docs = await Document.find({
      employeeId: req.params.employeeId,
      docType: { $in: hrDocTypes },
    });
    res.json({ success: true, data: docs });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= ACTIVATE EMPLOYEE =================
router.post("/activate", async (req, res) => {
  try {
    const { employee_id } = req.body;
    const details = await EmploymentDetails.findOne({ employee_id });
    if (!details)
      return res.status(400).json({ success: false, message: "Employment details not saved yet" });

    details.status = "active";
    details.activated_at = new Date();
    await details.save();

    const employee = await Employee.findByIdAndUpdate(
      employee_id,
      {
        status: "active",
        designation: details.employment?.designation,
        department:  details.employment?.department,
      },
      { new: true }
    );

    // ✅ Notify employee — account activated
    await createNotification({
      recipient_id:   employee_id,
      recipient_role: "employee",
      type:           "employee_activated",
      title:          "Account Activated 🎉",
      message:        `Welcome ${employee?.name || ""}! Your employee account is now active. Access your salary, documents and performance.`,
      link:           "/employee/dashboard"
    });

    res.json({ success: true, message: "Employee activated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= SAVE EMPLOYMENT + SALARY =================
router.post("/", async (req, res) => {
  try {
    const { employee_id, employment, salary } = req.body;
    const details = await EmploymentDetails.findOneAndUpdate(
      { employee_id },
      { employee_id, employment, salary, status: "draft" },
      { upsert: true, new: true }
    );
    res.json({ success: true, data: details });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ================= GET ACTIVATION DETAILS =================
router.get("/:employeeId", async (req, res) => {
  try {
    const details = await EmploymentDetails.findOne({ employee_id: req.params.employeeId });
    if (!details) return res.json({ success: false, data: null });
    res.json({ success: true, data: details });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;