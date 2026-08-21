const express = require("express");
const router = express.Router();
const LoanCustomer = require("../models/LoanCustomer");
const Employee = require("../models/Employee");

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