const express = require("express");
const router = express.Router();
const ExcelJS = require("exceljs");
const LoanCustomer = require("../models/LoanCustomer");
const Employee = require("../models/Employee");



// NOTE: Admin routes in this app don't use JWT auth (see leadRoutes.js pattern) —
// access is gated on the frontend via localStorage "admin-role". These routes
// give Admin FULL visibility across all telecallers' loan customers.

// ══════════════════════════════════════════════════════
//  GET dashboard metrics (always full grand total — no filters)
//  GET /api/admin-loan-process/metrics
// ══════════════════════════════════════════════════════
router.get("/metrics", async (req, res) => {
  try {
    const [totals] = await LoanCustomer.aggregate([
      {
        $group: {
          _id: null,
          totalApplications: { $sum: 1 },
          totalRevenue: { $sum: "$loanValue" },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
          },
          completedRevenue: {
            $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, "$loanValue", 0] },
          },
          inProgressCount: {
            $sum: { $cond: [{ $eq: ["$status", "IN_PROGRESS"] }, 1, 0] },
          },
          avgProgress: { $avg: "$processPercent" },
          pendingCount: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ["$reasonForPending", ""] }, { $ne: ["$reasonForPending", null] }] },
                1,
                0,
              ],
            },
          },
        },
      },
    ]);

    const staffBreakdown = await LoanCustomer.aggregate([
      {
        $group: {
          _id: "$staffId",
          staffName: { $first: "$staffName" },
          applications: { $sum: 1 },
          revenue: { $sum: "$loanValue" },
          completedCount: {
            $sum: { $cond: [{ $eq: ["$status", "COMPLETED"] }, 1, 0] },
          },
        },
      },
      { $sort: { revenue: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        totalApplications: totals?.totalApplications || 0,
        totalRevenue: totals?.totalRevenue || 0,
        completedCount: totals?.completedCount || 0,
        completedRevenue: totals?.completedRevenue || 0,
        inProgressCount: totals?.inProgressCount || 0,
        avgProgress: totals?.avgProgress ? Math.round(totals.avgProgress) : 0,
        pendingCount: totals?.pendingCount || 0,
        staffBreakdown,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// NOTE: Admin routes in this app don't use JWT auth (see leadRoutes.js pattern) —
// access is gated on the frontend via localStorage "admin-role". These routes
// give Admin FULL visibility across all telecallers' loan customers.

// ══════════════════════════════════════════════════════
//  GET all customers (every staff) — for Admin dashboard
//  GET /api/admin-loan-process/all
//  Optional query: ?staffId=...&status=...&search=...
// ══════════════════════════════════════════════════════
router.get("/all", async (req, res) => {
  try {
    const filter = {};
    if (req.query.staffId) filter.staffId = req.query.staffId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.search) {
      filter.customerName = { $regex: req.query.search, $options: "i" };
    }

    const customers = await LoanCustomer.find(filter)
      .populate("staffId", "name email")
      .sort({ createdAt: -1 });

    res.json({ success: true, data: customers, total: customers.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  GET single customer (full detail incl. documents)
//  GET /api/admin-loan-process/:id
// ══════════════════════════════════════════════════════
router.get("/:id", async (req, res) => {
  try {
    const customer = await LoanCustomer.findById(req.params.id).populate("staffId", "name email");
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });
    res.json({ success: true, data: customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  Admin ticks/unticks a checklist stage too (oversight)
//  PATCH /api/admin-loan-process/:id/checklist
// ══════════════════════════════════════════════════════
router.patch("/:id/checklist", async (req, res) => {
  try {
    const { field, value, reasonForPending } = req.body;
    const validFields = [
      "cibilVerification", "documentCollection", "applicationProcess",
      "quotation", "auditorReference", "documentPayment",
      "finalisationVerification", "finalSubmission", "courier", "completed",
    ];
    if (!validFields.includes(field)) {
      return res.status(400).json({ success: false, message: "Invalid checklist field" });
    }

    const customer = await LoanCustomer.findById(req.params.id);
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found" });

        customer.checklist[field] = !!value;
    customer.markModified("checklist");
    if (reasonForPending !== undefined) customer.reasonForPending = reasonForPending;
    await customer.save();

    res.json({ success: true, customer });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  Staff list — for the "filter by telecaller" dropdown
//  GET /api/admin-loan-process/staff-list
// ══════════════════════════════════════════════════════
router.get("/meta/staff-list", async (req, res) => {
  try {
    const staff = await LoanCustomer.distinct("staffId");
    const Employee = require("../models/Employee");
    const list = await Employee.find({ _id: { $in: staff } }).select("name email");
    res.json({ success: true, data: list });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  EXCEL REPORT — export loan customers to a downloadable .xlsx
//  GET /api/admin-loan-process/export/excel
//  Optional query (same filters as the admin dashboard):
//    ?staffId=...&status=...&search=...&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD&scheme=...
// ══════════════════════════════════════════════════════
router.get("/export/excel", async (req, res) => {
  try {
    const filter = {};
    if (req.query.staffId) filter.staffId = req.query.staffId;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.scheme) filter.scheme = req.query.scheme;
    if (req.query.search) {
      filter.customerName = { $regex: req.query.search, $options: "i" };
    }
    if (req.query.fromDate || req.query.toDate) {
      filter.loanDate = {};
      if (req.query.fromDate) filter.loanDate.$gte = new Date(req.query.fromDate);
      if (req.query.toDate) filter.loanDate.$lte = new Date(`${req.query.toDate}T23:59:59`);
    }

    const customers = await LoanCustomer.find(filter)
      .populate("staffId", "name email")
      .sort({ createdAt: -1 });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Radnus Connect";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Loan Customers", {
      views: [{ state: "frozen", ySplit: 1 }], // freeze header row
    });

    // ── Column definitions ────────────────────────────────────────────
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

    // ── Header row styling ────────────────────────────────────────────
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2A3EB1" },
    };
    headerRow.alignment = { vertical: "middle", horizontal: "left" };
    headerRow.height = 20;

    // ── Data rows ────────────────────────────────────────────────────
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

    // ── Rupee number formatting on the Loan Value column ────────────────
    sheet.getColumn("loanValue").numFmt = "₹#,##0";

    // ── Auto filter on header row ───────────────────────────────────
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columns.length },
    };

    // ── Send as a downloadable file ─────────────────────────────────
    const fileName = `loan-customers-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("EXCEL EXPORT ERROR", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  DELETE (admin only)
//  DELETE /api/admin-loan-process/:id
// ══════════════════════════════════════════════════════
router.delete("/:id", async (req, res) => {
  try {
    const deleted = await LoanCustomer.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ success: false, message: "Customer not found" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


// ══════════════════════════════════════════════════════
//  GET employees list — for Loan Process access toggle page
//  GET /api/admin-loan-process/access/employees
//  Optional query: ?search=...&department=...
// ══════════════════════════════════════════════════════
router.get("/access/employees", async (req, res) => {
  try {
    const filter = {};
    if (req.query.search) {
      filter.name = { $regex: req.query.search, $options: "i" };
    }
    if (req.query.department) {
      filter.department = req.query.department;
    }

        const employees = await Employee.find(filter)
      .select("name email department canManageLoanProcess isLoanProcessHead")
      .sort({ name: 1 });
      
    res.json({ success: true, data: employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  PATCH toggle Loan Process access for one employee
//  PATCH /api/admin-loan-process/access/:id
//  Body: { enabled: true/false }
// ══════════════════════════════════════════════════════
router.patch("/access/:id", async (req, res) => {
  try {
    const { enabled } = req.body;
    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { canManageLoanProcess: !!enabled },
      { new: true }
    ).select("name email department canManageLoanProcess");

    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    res.json({ success: true, data: employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  PATCH toggle "Loan Process Head" — only ONE employee at a time
//  PATCH /api/admin-loan-process/access/:id/head
//  Body: { isHead: true/false }
// ══════════════════════════════════════════════════════
router.patch("/access/:id/head", async (req, res) => {
  try {
    const { isHead } = req.body;

    if (isHead) {
      // oru employee dhan head — matha yaaravadhu head-a irundha off pannidu
      await Employee.updateMany({}, { isLoanProcessHead: false });
    }

    const employee = await Employee.findByIdAndUpdate(
      req.params.id,
      { isLoanProcessHead: !!isHead },
      { new: true }
    ).select("name email department canManageLoanProcess isLoanProcessHead");

    if (!employee) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    res.json({ success: true, data: employee });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;