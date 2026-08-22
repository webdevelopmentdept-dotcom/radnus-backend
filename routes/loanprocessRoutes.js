const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const mongoose = require("mongoose");

const LoanCustomer = require("../models/LoanCustomer");
const auth = require("../middleware/auth");

// ── Auth check — only employees with canManageLoanProcess OR hr role ───────
const canManageLoanProcess = async (req, res, next) => {
  try {
    // Admin → full access always
    if (req.user?.role === "admin") return next();

    // HR → explicitly BLOCKED from this module
    if (req.user?.role === "hr") {
      return res.status(403).json({ success: false, message: "HR does not have access to Loan Process module" });
    }

    // BDE Employee → allowed only if canManageLoanProcess flag is ON
    const Employee = require("../models/Employee");
    const employee = await Employee.findById(req.user?.id).select("canManageLoanProcess");
    if (!employee || !employee.canManageLoanProcess) {
      return res.status(403).json({ success: false, message: "You don't have access to Loan Process module" });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "Access check failed" });
  }
};

// ── Cloudinary storage — same pattern as routes/productRoutes.js ───────────
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "radnus-connect/loan-documents",
    resource_type: "auto", // handles both images and pdfs
    public_id: `${file.fieldname}_${Date.now()}_${Math.round(Math.random() * 1e5)}`,
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per file
});

// The 10 govt document fields — used both for upload.fields() and the loop below
const DOC_FIELDS = [
  "aadharCard",
  "passportPhoto",
  "signature",
  "study10th12th",
  "community",
  "pancard",
  "rationCard",
  "bankPassbook",
  "gasBill",
  "ebBill",
];

const uploadDocs = upload.fields(DOC_FIELDS.map((name) => ({ name, maxCount: 1 })));

// ══════════════════════════════════════════════════════
//  TAB 1 — CREATE CUSTOMER (with document upload)
//  POST /api/loan-process/create
// ══════════════════════════════════════════════════════
router.post("/create", auth, canManageLoanProcess, uploadDocs, async (req, res) => {
  try {
    const {
      customerName,
        loanDate,

      communicationAddress,
      unitAddress,
      businessType,
       scheme,  
      loanValue,
      contactNo,
      mailId,
      bankName,
      ifscCode,
    } = req.body;

    if (!customerName || !contactNo) {
      return res.status(400).json({ success: false, message: "Customer name and contact number required" });
    }

    // Build documents object from uploaded files (req.files)
    const documents = {};
    DOC_FIELDS.forEach((field) => {
      if (req.files && req.files[field] && req.files[field][0]) {
        documents[field] = {
          url: req.files[field][0].path,
          uploadedAt: new Date(),
          status: "uploaded",
        };
      }
    });

    // Staff info from JWT (req.user.id set by auth middleware)
    const Employee = require("../models/Employee");
    const staff = await Employee.findById(req.user.id).select("name");

    const customer = await LoanCustomer.create({
      customerName,
       loanDate: loanDate ? new Date(loanDate) : Date.now(),
      communicationAddress,
      unitAddress,
      businessType,
      scheme,  
      loanValue: Number(loanValue) || 0,
      contactNo,
      mailId,
      bankName,
      ifscCode,
      staffId: req.user.id,
      staffName: staff?.name || "Unknown",
      documents,
    });

    res.json({ success: true, customer });
  } catch (err) {
    console.error("Loan customer create error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  TAB 2 — LIST ALL CUSTOMERS (checklist view)
//  GET /api/loan-process/all
//  Optional query: ?staffId=... to filter by telecaller
// ══════════════════════════════════════════════════════
router.get("/all", auth, canManageLoanProcess, async (req, res) => {
  try {
    const filter = {};

    if (req.user?.role === "admin") {
      if (req.query.staffId) filter.staffId = req.query.staffId;
    } else {
      // Check if this employee is the designated Loan Process Head
      const Employee = require("../models/Employee");
      const employee = await Employee.findById(req.user.id).select("isLoanProcessHead");

      if (employee?.isLoanProcessHead && req.query.viewAll === "true") {
        // Head employee, "View Details" tab → every staff's data
        if (req.query.staffId) filter.staffId = req.query.staffId;
      } else {
        // Normal employee, OR head employee's own "Customer Data" tab → own data only
        filter.staffId = req.user.id;
      }
    }

    if (req.query.status) filter.status = req.query.status;

    const customers = await LoanCustomer.find(filter)
      .populate("staffId", "name email")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: customers, total: customers.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  GET SINGLE CUSTOMER (full details)
//  GET /api/loan-process/:id
// ══════════════════════════════════════════════════════
router.get("/:id", auth, canManageLoanProcess, async (req, res) => {
  try {
    const customer = await LoanCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  UPDATE CHECKLIST (tick/untick a process stage)
//  PATCH /api/loan-process/:id/checklist
//  Body: { field: "cibilVerification", value: true, reasonForPending?: "..." }
// ══════════════════════════════════════════════════════
router.patch("/:id/checklist", auth, canManageLoanProcess, async (req, res) => {
  try {
    const { field, value, reasonForPending } = req.body;

    const validFields = [
      "cibilVerification",
      "documentCollection",
      "applicationProcess",
      "quotation",
      "auditorReference",
      "documentPayment",
      "finalisationVerification",
      "finalSubmission",
      "courier",
      "completed",
    ];

    if (!validFields.includes(field)) {
      return res.status(400).json({ success: false, message: "Invalid checklist field" });
    }

    const customer = await LoanCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    customer.checklist[field] = !!value;
    if (reasonForPending !== undefined) customer.reasonForPending = reasonForPending;

    await customer.save(); // pre-save hook recalculates processPercent + status

    res.json({ success: true, customer });
  } catch (err) {
    console.error("Checklist update error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  RE-UPLOAD / UPDATE A SINGLE DOCUMENT
//  PATCH /api/loan-process/:id/documents
//  multipart form-data, field name = doc key (e.g. "aadharCard")
// ══════════════════════════════════════════════════════
router.patch("/:id/documents", auth, canManageLoanProcess, uploadDocs, async (req, res) => {
  try {
    const customer = await LoanCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    DOC_FIELDS.forEach((field) => {
      if (req.files && req.files[field] && req.files[field][0]) {
        customer.documents[field] = {
          url: req.files[field][0].path,
          uploadedAt: new Date(),
          status: "uploaded",
        };
      }
    });

    await customer.save();
    res.json({ success: true, customer });
  } catch (err) {
    console.error("Document update error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  UPDATE BASIC DETAILS (Tab 1 edit, no file)
//  PUT /api/loan-process/:id
// ══════════════════════════════════════════════════════
router.put("/:id", auth, canManageLoanProcess, async (req, res) => {
  try {
    const {
      customerName,
        loanDate,

      communicationAddress,
      unitAddress,
      businessType,
      scheme,
      loanValue,
      contactNo,
      mailId,
      bankName,
      ifscCode,
    } = req.body;

    const customer = await LoanCustomer.findByIdAndUpdate(
      req.params.id,
      {
        customerName,
            loanDate: loanDate ? new Date(loanDate) : undefined,

        communicationAddress,
        unitAddress,
        businessType,
         scheme,
        loanValue: Number(loanValue) || 0,
        contactNo,
        mailId,
        bankName,
        ifscCode,
      },
      { new: true }
    );

    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  DELETE CUSTOMER
//  DELETE /api/loan-process/:id
// ══════════════════════════════════════════════════════
router.delete("/:id", auth, canManageLoanProcess, async (req, res) => {
  try {
    const deleted = await LoanCustomer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Customer not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;