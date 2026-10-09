const express = require("express");
const router = express.Router();
const LoanCustomer = require("../models/LoanCustomer");
const Employee = require("../models/Employee");
const auth = require("../middleware/auth");

// Followup team (flag) or Admin only. HR blocked, same as Loan Process.
const canManageLoanFollowup = async (req, res, next) => {
  try {
    if (req.user?.role === "admin") return next();
    if (req.user?.role === "hr") {
      return res.status(403).json({ success: false, message: "HR does not have access to Loan Followup" });
    }
    const emp = await Employee.findById(req.user?.id).select("name canManageLoanFollowup");
    if (!emp || !emp.canManageLoanFollowup) {
      return res.status(403).json({ success: false, message: "You don't have access to Loan Followup" });
    }
    req.followupEmployee = emp;
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "Access check failed" });
  }
};

// Followup team sees ONLY customer details — no documents, no checklist.
const CUSTOMER_FIELDS =
  "customerName contactNo mailId loanDate scheme loanValue businessType businessSubType " +
  "communicationAddress unitAddress bankName ifscCode staffName followup createdAt";

// GET /api/loan-followup/list?tab=pending|completed&search=
router.get("/list", auth, canManageLoanFollowup, async (req, res) => {
  try {
    const tab = req.query.tab === "completed" ? "COMPLETED" : "PENDING";
    const filter = { "followup.status": tab };
    if (req.query.search) {
      filter.$or = [
        { customerName: { $regex: req.query.search, $options: "i" } },
        { contactNo: { $regex: req.query.search, $options: "i" } },
      ];
    }
    const data = await LoanCustomer.find(filter)
      .select(CUSTOMER_FIELDS) // documents & checklist are NOT selected
      .sort(tab === "COMPLETED" ? { "followup.completedAt": -1 } : { "followup.handedOverAt": -1 });

    const counts = {
      pending: await LoanCustomer.countDocuments({ "followup.status": "PENDING" }),
      completed: await LoanCustomer.countDocuments({ "followup.status": "COMPLETED" }),
    };
    res.json({ success: true, data, counts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const actorName = (req) => req.followupEmployee?.name || (req.user?.role === "admin" ? "Admin" : "Unknown");

// PATCH /api/loan-followup/:id/step   Body: { step: "dicOffice"|"bank", state: ""|"COMPLETED"|"NOT_COMPLETED", reason }
// state "" = Clear (back to blank)
router.patch("/:id/step", auth, canManageLoanFollowup, async (req, res) => {
  try {
    const { step, state, reason } = req.body;
    if (!["dicOffice", "bank"].includes(step)) {
      return res.status(400).json({ success: false, message: "Invalid step" });
    }
    if (!["", "COMPLETED", "NOT_COMPLETED"].includes(state)) {
      return res.status(400).json({ success: false, message: "Invalid state" });
    }
    if (state === "NOT_COMPLETED" && !String(reason || "").trim()) {
      return res.status(400).json({ success: false, message: "Reason is required when not completed" });
    }

    const c = await LoanCustomer.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Customer not found" });
    if (c.followup.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "This customer is not in the pending list" });
    }

    c.followup[step] = {
      state,
      reason: state === "NOT_COMPLETED" ? String(reason).trim() : "",
      updatedAt: state ? new Date() : null,
      updatedByName: state ? actorName(req) : "",
    };
    c.markModified("followup");
    await c.save();
    res.json({ success: true, customer: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/loan-followup/:id/sanction   Body: { value: ""|"YES"|"NO" }
// value "" = Clear (back to blank)
router.patch("/:id/sanction", auth, canManageLoanFollowup, async (req, res) => {
  try {
    const { value } = req.body;
    if (!["", "YES", "NO"].includes(value)) {
      return res.status(400).json({ success: false, message: "Invalid value" });
    }
    const c = await LoanCustomer.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Customer not found" });
    if (c.followup.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "This customer is not in the pending list" });
    }

    if (value === "YES") {
      if (c.followup.dicOffice?.state !== "COMPLETED" || c.followup.bank?.state !== "COMPLETED") {
        return res.status(400).json({
          success: false,
          message: "DIC Office and Bank Process must both be Completed before marking Loan Sanctioned = Yes",
        });
      }
    }

    c.followup.loanSanctioned = {
      value,
      updatedAt: value ? new Date() : null,
      updatedByName: value ? actorName(req) : "",
    };
    if (value === "YES") {
      c.followup.status = "COMPLETED";   // Pending tab → Completed tab
      c.followup.completedAt = new Date();
    }
    c.markModified("followup");
    await c.save();
    res.json({ success: true, customer: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;