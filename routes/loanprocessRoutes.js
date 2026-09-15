const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const mongoose = require("mongoose");
const ExcelJS = require("exceljs");

const LoanCustomer = require("../models/LoanCustomer");
const auth = require("../middleware/auth");
const { createNotification } = require("../helpers/notificationHelper");


// ── Loan Incentive approval — HR (fixed login) or Admin only ──
// Deliberately separate from canManageLoanProcess: HR is blocked from the
// general Loan Process module, but HR does approve/pay loan incentives.
const canApproveLoanIncentive = (req, res, next) => {
  if (req.user?.role === "admin" || req.user?.role === "hr") return next();
  return res.status(403).json({ success: false, message: "You don't have access to Loan Incentive approvals" });
};


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

const canViewLoanProcessReport = async (req, res, next) => {
  try {
    if (req.user?.role === "admin") return next();
    if (req.user?.role === "hr") {
      return res.status(403).json({ success: false, message: "HR does not have access to Loan Process reports" });
    }
    const Employee = require("../models/Employee");
    const employee = await Employee.findById(req.user?.id).select("loanProcessReportAccess");
    if (!employee || !employee.loanProcessReportAccess) {
      return res.status(403).json({ success: false, message: "You don't have access to the Loan Process report" });
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
router.post("/create", auth, canManageLoanProcess, (req, res, next) => {
  uploadDocs(req, res, (err) => {
    if (err) {
      console.error("Upload error:", err);
      return res.status(400).json({
        success: false,
        message:
          err.code === "LIMIT_FILE_SIZE"
            ? "One of the documents is larger than 5MB. Please upload a smaller file."
            : err.message || "File upload failed",
      });
    }
    next();
  });
}, async (req, res) => {
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


router.get("/report", auth, canViewLoanProcessReport, async (req, res) => {
  try {
        const filter = {};
    if (req.query.staffId) filter.staffId = req.query.staffId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.dateFrom || req.query.dateTo) {
      filter.loanDate = {};
      if (req.query.dateFrom) filter.loanDate.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) filter.loanDate.$lte = new Date(`${req.query.dateTo}T23:59:59`);
    }

    const customers = await LoanCustomer.find(filter)
      .select("-documents")
      .populate("staffId", "name email")
      .sort({ createdAt: -1 });

    const staffBreakdown = await LoanCustomer.aggregate([
  {
    $group: {
      _id: "$staffId",
      staffName: { $first: "$staffName" },
      applications: { $sum: 1 },
      revenue: { $sum: "$loanValue" },
      completedCount: { $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] } },
    },
  },
  {
    $project: {
      staffName: 1, applications: 1, revenue: 1, completedCount: 1,
      conversionRate: {
        $cond: [{ $eq: ["$applications", 0] }, 0, { $round: [{ $multiply: [{ $divide: ["$completedCount", "$applications"] }, 100] }, 0] }],
      },
    },
  },
  { $sort: { revenue: -1 } },
]);

    res.json({ success: true, data: customers, staffBreakdown, total: customers.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.get("/report/export", auth, canViewLoanProcessReport, async (req, res) => {
  try {
    const filter = {};
    if (req.query.staffId) filter.staffId = req.query.staffId;
    if (req.query.status) filter.status = req.query.status;

    // ⬇️ ITHU RENDU BLOCK ADD PANNANUM (idhu than fix)
    if (req.query.dateFrom || req.query.dateTo) {
      filter.loanDate = {};
      if (req.query.dateFrom) filter.loanDate.$gte = new Date(req.query.dateFrom);
      if (req.query.dateTo) filter.loanDate.$lte = new Date(`${req.query.dateTo}T23:59:59`);
    }
    if (req.query.search) {
      filter.customerName = { $regex: req.query.search, $options: "i" };
    }

    const customers = await LoanCustomer.find(filter)
      .select("-documents")
      .populate("staffId", "name email")
      .sort({ createdAt: -1 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Radnus Connect";
    workbook.created = new Date();
    const sheet = workbook.addWorksheet("Loan Process Report", { views: [{ state: "frozen", ySplit: 1 }] });

    sheet.columns = [
      { header: "Customer Name", key: "customerName", width: 24 },
      { header: "Contact No", key: "contactNo", width: 15 },
      { header: "Mail ID", key: "mailId", width: 26 },
      { header: "Telecaller", key: "staffName", width: 18 },
      { header: "Loan Date", key: "loanDate", width: 14 },
      { header: "Business Type", key: "businessType", width: 20 },
      { header: "Scheme", key: "scheme", width: 12 },
      { header: "Loan Value (₹)", key: "loanValue", width: 16 },
      { header: "Bank Name", key: "bankName", width: 18 },
      { header: "IFSC Code", key: "ifscCode", width: 14 },
      { header: "Communication Address", key: "communicationAddress", width: 30 },
      { header: "Unit Address", key: "unitAddress", width: 30 },
      { header: "Status", key: "status", width: 14 },
      { header: "Progress %", key: "processPercent", width: 12 },
      { header: "CIBIL Verification", key: "cibilVerification", width: 16 },
      { header: "Document Collection", key: "documentCollection", width: 16 },
      { header: "Application Process", key: "applicationProcess", width: 16 },
      { header: "Quotation", key: "quotation", width: 12 },
      { header: "Auditor Reference", key: "auditorReference", width: 16 },
      { header: "Document Payment", key: "documentPayment", width: 16 },
      { header: "Finalisation & Verification", key: "finalisationVerification", width: 18 },
      { header: "Final Submission", key: "finalSubmission", width: 16 },
      { header: "Courier", key: "courier", width: 12 },
      { header: "Completed", key: "completed", width: 12 },
      { header: "Reason For Pending", key: "reasonForPending", width: 26 },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A3EB1" } };
    headerRow.alignment = { vertical: "middle", horizontal: "left" };
    headerRow.height = 20;

    customers.forEach((c) => {
      sheet.addRow({
        customerName: c.customerName || "",
        contactNo: c.contactNo || "",
        mailId: c.mailId || "",
        staffName: c.staffId?.name || c.staffName || "Unknown",
        loanDate: c.loanDate ? new Date(c.loanDate).toLocaleDateString("en-IN") : "",
        businessType: c.businessType || "",
        scheme: c.scheme || "",
        loanValue: c.loanValue || 0,
        bankName: c.bankName || "",
        ifscCode: c.ifscCode || "",
        communicationAddress: c.communicationAddress || "",
        unitAddress: c.unitAddress || "",
        status: c.status === "COMPLETED" ? "Completed" : "In Progress",
        processPercent: c.processPercent ?? 0,
        cibilVerification: c.checklist?.cibilVerification ? "Yes" : "No",
        documentCollection: c.checklist?.documentCollection ? "Yes" : "No",
        applicationProcess: c.checklist?.applicationProcess ? "Yes" : "No",
        quotation: c.checklist?.quotation ? "Yes" : "No",
        auditorReference: c.checklist?.auditorReference ? "Yes" : "No",
        documentPayment: c.checklist?.documentPayment ? "Yes" : "No",
        finalisationVerification: c.checklist?.finalisationVerification ? "Yes" : "No",
        finalSubmission: c.checklist?.finalSubmission ? "Yes" : "No",
        courier: c.checklist?.courier ? "Yes" : "No",
        completed: c.checklist?.completed ? "Yes" : "No",
        reasonForPending: c.reasonForPending || "",
      });
    });

    sheet.getColumn("loanValue").numFmt = "₹#,##0";
    sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
   
        // ── Employee-wise Summary sheet ─────────────────────────────────────
    const staffMap = {};
    customers.forEach((c) => {
      const key = c.staffId?._id?.toString() || c.staffId?.toString() || c.staffName || "unknown";
      const name = c.staffId?.name || c.staffName || "Unknown";
      if (!staffMap[key]) staffMap[key] = { staffName: name, applications: 0, revenue: 0, completedCount: 0 };
      staffMap[key].applications += 1;
      staffMap[key].revenue += c.loanValue || 0;
      if (c.status === "COMPLETED") staffMap[key].completedCount += 1;
    });

    const staffRows = Object.values(staffMap).sort((a, b) => b.revenue - a.revenue);

    const staffSheet = workbook.addWorksheet("Employee-wise Summary", { views: [{ state: "frozen", ySplit: 1 }] });
    staffSheet.columns = [
      { header: "Rank", key: "rank", width: 8 },
      { header: "Employee", key: "staffName", width: 22 },
      { header: "Applications", key: "applications", width: 14 },
      { header: "Revenue (₹)", key: "revenue", width: 16 },
      { header: "Completed", key: "completedCount", width: 12 },
      { header: "Conversion %", key: "conversionRate", width: 14 },
    ];

    const staffHeaderRow = staffSheet.getRow(1);
    staffHeaderRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    staffHeaderRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A3EB1" } };
    staffHeaderRow.alignment = { vertical: "middle", horizontal: "left" };
    staffHeaderRow.height = 20;

    staffRows.forEach((r, i) => {
      staffSheet.addRow({
        rank: i + 1,
        staffName: r.staffName,
        applications: r.applications,
        revenue: r.revenue,
        completedCount: r.completedCount,
        conversionRate: r.applications ? Math.round((r.completedCount / r.applications) * 100) : 0,
      });
    });
    staffSheet.getColumn("revenue").numFmt = "₹#,##0";
    staffSheet.getColumn("conversionRate").numFmt = '0"%"';
    staffSheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: staffSheet.columns.length } };
    
    const fileName = `loan-process-report-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("REPORT EXCEL EXPORT ERROR", err);
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
    const { field, value, reasonForPending, remark, date } = req.body;
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

    // ── Lock: once incentive is Paid, these 2 fields can't change anymore.
    const INCENTIVE_LINKED_FIELDS = ["applicationProcess", "courier"];
    if (
      customer.incentive?.eligibility === "Paid" &&
      INCENTIVE_LINKED_FIELDS.includes(field) &&
      !!value !== !!customer.checklist[field]
    ) {
      return res.status(400).json({
        success: false,
        message: "Incentive already paid for this loan — Online Loan Application / Projection Dispatch can't be changed anymore.",
      });
    }

    const wasEligible = customer.incentive?.eligibility === "Eligible for Processing";

                customer.checklist[field] = !!value;
    customer.markModified("checklist");
    if (reasonForPending !== undefined) customer.reasonForPending = reasonForPending;
        if (remark !== undefined) {
      customer.checklistRemarks[field] = remark;
      customer.markModified("checklistRemarks");
    }
    if (date !== undefined) {
      customer.checklistDates[field] = date ? new Date(date) : null;
      customer.markModified("checklistDates");
    }

    await customer.save(); // pre("save") hook flips customer.incentive.eligibility

    const nowEligible = customer.incentive.eligibility === "Eligible for Processing";

    if (!wasEligible && nowEligible) {
      createNotification({
        recipient_id: String(customer.staffId),
        recipient_role: "employee",
        type: "incentive_review",
        title: "Eligible for loan incentive",
        message: `You're eligible for incentive processing on ${customer.customerName}'s loan — Online Loan Application & Projection Dispatch both done.`,
        link: "/employee/dashboard/loan-process",
      });
      createNotification({
        recipient_id: null,
        recipient_role: "hr",
        type: "incentive_review",
        title: "Loan incentive pending approval",
        message: `${customer.staffName} completed both activities for ${customer.customerName}'s loan — pending your approval.`,
        link: "/hr/dashboard/incentives/loan-payouts",
      });
    }

    res.json({ success: true, customer });
  } catch (err) {
    console.error("Checklist update error:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  LOAN INCENTIVE — list loans pending HR approval
//  GET /api/loan-process/incentives/pending
// ══════════════════════════════════════════════════════
router.get("/incentives/pending", auth, canApproveLoanIncentive, async (req, res) => {
  try {
    const customers = await LoanCustomer.find({ "incentive.eligibility": "Eligible for Processing" })
      .select("customerName loanValue staffId staffName incentive checklistDates createdAt")
      .sort({ "incentive.eligibleAt": 1 });
    res.json({ success: true, customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  LOAN INCENTIVE — list loans already paid (HR/Admin history)
//  GET /api/loan-process/incentives/paid
// ══════════════════════════════════════════════════════
router.get("/incentives/paid", auth, canApproveLoanIncentive, async (req, res) => {
  try {
    const customers = await LoanCustomer.find({ "incentive.eligibility": "Paid" })
      .select("customerName loanValue staffId staffName incentive checklistDates createdAt")
      .sort({ "incentive.paidAt": -1 });
    res.json({ success: true, customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  LOAN INCENTIVE — my own loans + incentive status
//  GET /api/loan-process/incentives/mine
// ══════════════════════════════════════════════════════
router.get("/incentives/mine", auth, async (req, res) => {
  try {
    if (!req.user?.id) return res.json({ success: true, customers: [] });
    const customers = await LoanCustomer.find({
      staffId: req.user.id,
      "incentive.eligibility": { $in: ["Eligible for Processing", "Paid"] },
    })
      .select("customerName loanValue incentive")
      .sort({ "incentive.eligibleAt": -1 });
    res.json({ success: true, customers });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  LOAN INCENTIVE — Approve & pay (HR/Admin, manual amount)
//  POST /api/loan-process/:id/incentive/approve
//  Body: { amount, remark? }
// ══════════════════════════════════════════════════════
router.post("/:id/incentive/approve", auth, canApproveLoanIncentive, async (req, res) => {
  try {
    const { amount, remark } = req.body;
    const amt = Number(amount);
    if (!amt || amt <= 0) {
      return res.status(400).json({ success: false, message: "Enter a valid incentive amount" });
    }

    const customer = await LoanCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

    if (customer.incentive.eligibility !== "Eligible for Processing") {
      return res.status(400).json({
        success: false,
        message: "This loan isn't in 'Eligible for Processing' state.",
      });
    }

    customer.incentive.eligibility = "Paid";
    customer.incentive.amount = amt;
    customer.incentive.paidAt = new Date();
    customer.incentive.paidBy = mongoose.Types.ObjectId.isValid(req.user?.id)
  ? req.user.id
  : null;
    customer.incentive.paidByName = req.user?.name || (req.user?.role === "hr" ? "HR" : "Admin");
    customer.incentive.paidRemark = remark || "";
    await customer.save();

    createNotification({
      recipient_id: String(customer.staffId),
      recipient_role: "employee",
      type: "incentive_paid",
      title: "Loan incentive paid",
      message: `₹${amt} incentive paid for ${customer.customerName}'s loan.`,
      link: "/employee/dashboard/loan-process",
    });

    res.json({ success: true, customer });
  } catch (err) {
    console.error("Incentive approve error:", err);
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