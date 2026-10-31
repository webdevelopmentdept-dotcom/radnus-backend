const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const ExcelJS = require("exceljs");

const cloudinary = require("../config/cloudinary");
const auth = require("../middleware/auth");
const Employee = require("../models/Employee");
const AdmissionStudent = require("../models/AdmissionStudent");
const AdmissionCourse = require("../models/AdmissionCourse");
const AdmissionSettings = require("../models/AdmissionSettings");
const {
  applyBody,
  validateForComplete,
  nextApplicationNo,
  buildPdf,
  sendApplicationEmail,
} = require("../services/admissionService");

// ── Access helpers ───────────────────────────────────────
const getFlags = async (req) => {
  // Admin is VIEW-ONLY: can read everything / download PDFs, but never create or modify
  if (req.user?.role === "admin") return { isAdmin: true, canManage: false, canReport: true, name: "Admin" };
  if (req.user?.role === "hr") return { isAdmin: false, canManage: false, canReport: false };
  const emp = await Employee.findById(req.user?.id).select("name canManageAdmission admissionReportAccess");
  return {
    isAdmin: false,
    canManage: !!emp?.canManageAdmission,
    canReport: !!emp?.admissionReportAccess,
    name: emp?.name || "",
  };
};

const actorName = async (req) => {
  const emp = await Employee.findById(req.user?.id).select("name");
  return emp?.name || "";
};

// Telecaller only (admin is view-only)
const canManageAdmission = async (req, res, next) => {
  try {
    const f = await getFlags(req);
    if (!f.canManage) return res.status(403).json({ success: false, message: "You don't have access to the Admission module" });
    req.flags = f;
    next();
  } catch {
    res.status(500).json({ success: false, message: "Access check failed" });
  }
};

// Report access (or admin)
const canViewAdmissionReport = async (req, res, next) => {
  try {
    const f = await getFlags(req);
    if (!f.canReport) return res.status(403).json({ success: false, message: "You don't have access to the Admission report" });
    req.flags = f;
    next();
  } catch {
    res.status(500).json({ success: false, message: "Access check failed" });
  }
};

// Load the student and decide if this user can touch it.
//   write=true  → only the telecaller who created the student
//   write=false → owner telecaller, report-access users, admin (view / PDF)
const loadStudent = (write) => async (req, res, next) => {
  try {
    const f = await getFlags(req);
    const student = await AdmissionStudent.findById(req.params.id);
    if (!student) return res.status(404).json({ success: false, message: "Student not found" });

    const isOwner = String(student.staffId) === String(req.user?.id);
    const ok = (f.canManage && isOwner) || (!write && (f.isAdmin || f.canReport));
    if (!ok) return res.status(403).json({ success: false, message: write ? "Only the telecaller who created this student can modify it" : "You don't have access to this student" });

    req.flags = f;
    req.student = student;
    next();
  } catch {
    res.status(404).json({ success: false, message: "Student not found" });
  }
};

// ── Cloudinary upload (same pattern as loanprocessRoutes.js) ──
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "radnus/admission-documents",
    resource_type: "auto", // images + pdf
    public_id: `${file.fieldname}_${Date.now()}_${Math.round(Math.random() * 1e5)}`,
  }),
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } }); // 5MB
const DOC_FIELDS = ["photo", "aadhaar"];
const uploadDocs = upload.fields(DOC_FIELDS.map((name) => ({ name, maxCount: 1 })));

const withUpload = (req, res, next) =>
  uploadDocs(req, res, (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message || "File upload failed" });
    next();
  });

const attachFiles = (student, files) => {
  DOC_FIELDS.forEach((f) => {
    if (files?.[f]?.[0]) student.documents[f] = { url: files[f][0].path, uploadedAt: new Date() };
  });
};

// ── Filters ──────────────────────────────────────────────
const buildFilter = (q, base = {}) => {
  const filter = { ...base };
  if (q.status) filter.status = q.status;
  if (q.staffId) filter.staffId = q.staffId;
  if (q.paymentStatus) filter.paymentStatus = q.paymentStatus;
  if (q.from || q.to) {
    filter.applicationDate = {};
    if (q.from) filter.applicationDate.$gte = new Date(q.from);
    if (q.to) filter.applicationDate.$lte = new Date(new Date(q.to).setHours(23, 59, 59, 999));
  }
  if (q.search) {
    const rx = { $regex: String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
    filter.$or = [{ fullName: rx }, { mobileNo: rx }, { applicationNo: rx }, { shopName: rx }];
  }
  return filter;
};

// ══════════════════════════════════════════════════════
//  GET /api/admission/my-access
// ══════════════════════════════════════════════════════
router.get("/my-access", auth, async (req, res) => {
  try {
    const f = await getFlags(req);
    res.json({ success: true, canManage: f.canManage, canReport: f.canReport });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admission/courses — dropdown data (fee master)
router.get("/courses", auth, canManageAdmission, async (req, res) => {
  try {
    await AdmissionCourse.ensureSeeded();
    const data = await AdmissionCourse.find({ active: true }).sort({ order: 1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admission/register-no — pre-filled, read-only on the form
router.get("/register-no", auth, canManageAdmission, async (req, res) => {
  try {
    const s = await AdmissionSettings.getSingleton();
    res.json({ success: true, registerNo: s.registerNo });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admission/my?status=&search=  — the telecaller's own students
router.get("/my", auth, canManageAdmission, async (req, res) => {
  try {
    const base = { staffId: req.user.id };
    const data = await AdmissionStudent.find(buildFilter(req.query, base)).sort({ updatedAt: -1 });
    res.json({ success: true, data, total: data.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  REPORT (read-only)  GET /api/admission/report
// ══════════════════════════════════════════════════════
router.get("/report", auth, canViewAdmissionReport, async (req, res) => {
  try {
    const data = await AdmissionStudent.find(buildFilter(req.query)).sort({ applicationDate: -1 });
    const summary = {
      total: data.length,
      drafts: data.filter((s) => s.status === "DRAFT").length,
      completed: data.filter((s) => s.status === "APPLICATION_COMPLETED").length,
      fullyCompleted: data.filter((s) => s.status === "FULLY_COMPLETED").length,
      totalFees: data.reduce((a, s) => a + (s.status === "DRAFT" ? 0 : s.totalFees || 0), 0),
      collected: data.reduce((a, s) => a + (s.paidAmount || 0), 0),
      balance: data.reduce((a, s) => a + (s.status === "DRAFT" ? 0 : s.balance || 0), 0),
    };
    res.json({ success: true, summary, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/report/export", auth, canViewAdmissionReport, async (req, res) => {
  try {
    const data = await AdmissionStudent.find(buildFilter(req.query)).sort({ applicationDate: -1 });
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Admissions");
    ws.columns = [
      { header: "Application No", key: "applicationNo", width: 20 },
      { header: "Date", key: "date", width: 12 },
      { header: "Student", key: "fullName", width: 24 },
      { header: "Mobile", key: "mobileNo", width: 14 },
      { header: "Course", key: "course", width: 22 },
      { header: "Scheme", key: "scheme", width: 20 },
      { header: "Batch No", key: "batchNo", width: 10 },
      { header: "Bill No", key: "billNo", width: 10 },
      { header: "Total Fees", key: "totalFees", width: 12 },
      { header: "Paid", key: "paidAmount", width: 12 },
      { header: "Balance", key: "balance", width: 12 },
      { header: "Payment", key: "paymentStatus", width: 12 },
      { header: "Status", key: "status", width: 22 },
      { header: "BDA", key: "staffName", width: 18 },
    ];
    ws.getRow(1).font = { bold: true };
    data.forEach((s) =>
      ws.addRow({
        applicationNo: s.applicationNo || "(draft)",
        date: s.applicationDate ? new Date(s.applicationDate).toLocaleDateString("en-IN") : "",
        fullName: s.fullName,
        mobileNo: s.mobileNo,
        course: s.course?.name || "",
        scheme: s.scheme?.name || "",
        batchNo: s.batchNo,
        billNo: s.billNo,
        totalFees: s.totalFees,
        paidAmount: s.paidAmount,
        balance: s.balance,
        paymentStatus: s.paymentStatus,
        status: s.status,
        staffName: s.staffName,
      })
    );
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", 'attachment; filename="admissions.xlsx"');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  CREATE (saved as DRAFT)   POST /api/admission/create  (multipart)
// ══════════════════════════════════════════════════════
router.post("/create", auth, canManageAdmission, withUpload, async (req, res) => {
  try {
    const b = req.body || {};
    if (!b.fullName || !String(b.fullName).trim()) return res.status(400).json({ success: false, message: "Full Name is required" });
    if (!b.mobileNo || !String(b.mobileNo).trim()) return res.status(400).json({ success: false, message: "Mobile No is required" });

    const settings = await AdmissionSettings.getSingleton();
    const student = new AdmissionStudent({
      fullName: String(b.fullName).trim(),
      mobileNo: String(b.mobileNo).trim(),
      staffId: req.user.id,
      staffName: req.flags.name,
      registerNo: settings.registerNo, // snapshot
    });
    await applyBody(student, b);
    attachFiles(student, req.files);
    await student.save();
    res.status(201).json({ success: true, data: student });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  PDF / EMAIL / SINGLE
// ══════════════════════════════════════════════════════
router.get("/:id/pdf", auth, loadStudent(false), async (req, res) => {
  try {
    const pdf = await buildPdf(req.student);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${req.student.applicationNo || "draft-application"}.pdf"`);
    res.send(pdf);
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/:id/send-email", auth, loadStudent(true), async (req, res) => {
  try {
    const s = req.student;
    if (s.status === "DRAFT") return res.status(400).json({ success: false, message: "Complete the application first" });
    try {
      await sendApplicationEmail(s);
      s.emailStatus = "SENT";
      s.emailSentAt = new Date();
      s.emailError = "";
    } catch (e) {
      s.emailStatus = "FAILED";
      s.emailError = e.message;
    }
    await s.save();
    if (s.emailStatus === "FAILED") return res.status(502).json({ success: false, message: `Email failed: ${s.emailError}`, data: s });
    res.json({ success: true, message: "Email sent", data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/:id", auth, loadStudent(false), (req, res) => {
  res.json({ success: true, data: req.student });
});

// ══════════════════════════════════════════════════════
//  UPDATE   PUT /api/admission/:id  (multipart, files optional)  — owner telecaller only
//  Draft     → free edit.
//  Completed → details editable; once a payment exists, Course / Scheme /
//              Accommodation / Discount are locked. Required fields are re-validated.
// ══════════════════════════════════════════════════════
router.put("/:id", auth, loadStudent(true), withUpload, async (req, res) => {
  try {
    const s = req.student;
    const draft = s.status === "DRAFT";
    const lockFee = !draft && (s.payments || []).length > 0;

    await applyBody(s, req.body || {}, { lockFee });
    attachFiles(s, req.files);

    if (!draft) {
      const errors = validateForComplete(s);
      if (errors.length) return res.status(400).json({ success: false, message: errors[0], errors });
    }
    await s.save(); // totals / status are recalculated by the model
    res.json({ success: true, data: s });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  COMPLETE   POST /api/admission/:id/complete
//  Validates → assigns Application No → status APPLICATION_COMPLETED → emails PDF
// ══════════════════════════════════════════════════════
router.post("/:id/complete", auth, loadStudent(true), async (req, res) => {
  try {
    const s = req.student;
    if (s.status !== "DRAFT") return res.status(400).json({ success: false, message: "Application is already completed" });

    const errors = validateForComplete(s);
    if (errors.length) return res.status(400).json({ success: false, message: errors[0], errors });

    s.applicationNo = await nextApplicationNo();
    s.status = "APPLICATION_COMPLETED";
    s.completedAt = new Date();
    s.applicationDate = new Date();
    await s.save();

    // Email is best-effort: a mail failure never blocks the completion
    if (s.email) {
      try {
        await sendApplicationEmail(s);
        s.emailStatus = "SENT";
        s.emailSentAt = new Date();
      } catch (e) {
        s.emailStatus = "FAILED";
        s.emailError = e.message;
      }
      await s.save();
    }
    res.json({ success: true, data: s, emailStatus: s.emailStatus });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  PAYMENTS (recorded after the application is completed)
//  POST   /api/admission/:id/payments               body: { amount, type, paidDate, mode, refNo }
//  DELETE /api/admission/:id/payments/:paymentId    (same telecaller — fix a wrong entry)
//  Balance reaching 0 moves the student to FULLY_COMPLETED (model pre-save).
// ══════════════════════════════════════════════════════
router.post("/:id/payments", auth, loadStudent(true), async (req, res) => {
  try {
    const s = req.student;
    if (s.status === "DRAFT") return res.status(400).json({ success: false, message: "Complete the application before recording payments" });
    if (s.balance <= 0) return res.status(400).json({ success: false, message: "Fees are already fully paid" });

    const amount = Number(req.body.amount);
    if (!Number.isInteger(amount) || amount < 1) return res.status(400).json({ success: false, message: "Enter a valid amount" });
    if (amount > s.balance) {
      return res.status(400).json({ success: false, message: `Amount (₹${amount}) is more than the balance (₹${s.balance})` });
    }
    if (!AdmissionStudent.PAYMENT_MODES.includes(req.body.mode)) {
      return res.status(400).json({ success: false, message: "Select a payment mode" });
    }
    const type = AdmissionStudent.PAYMENT_TYPES.includes(req.body.type) ? req.body.type : "Other";
    const paidDate = req.body.paidDate ? new Date(req.body.paidDate) : new Date();
    if (isNaN(paidDate)) return res.status(400).json({ success: false, message: "Invalid paid date" });

    s.payments.push({
      amount,
      type,
      paidDate,
      mode: req.body.mode,
      refNo: String(req.body.refNo || "").trim(),
      receivedByName: await actorName(req),
    });
    await s.save(); // pre-save recalculates paid / balance / status
    res.status(201).json({ success: true, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.delete("/:id/payments/:paymentId", auth, loadStudent(true), async (req, res) => {
  try {
    const s = req.student;
    const pay = s.payments.id(req.params.paymentId);
    if (!pay) return res.status(404).json({ success: false, message: "Payment not found" });
    pay.deleteOne();
    await s.save();
    res.json({ success: true, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE — owner telecaller only (e.g. an application filled wrongly).
// Blocked while payments are recorded: remove those first so money records are never lost silently.
router.delete("/:id", auth, loadStudent(true), async (req, res) => {
  try {
    const s = req.student;
    if ((s.payments || []).length > 0) {
      return res.status(400).json({
        success: false,
        message: "This application has recorded payments. Remove the payments first, then delete the application.",
      });
    }
    await s.deleteOne();
    res.json({ success: true, message: s.status === "DRAFT" ? "Draft deleted" : "Application deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;