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

const actorName = (req) => req.followupEmployee?.name || (req.user?.role === "admin" ? "Admin" : "Unknown");
const myIdOf = (req) => (req.user?.role === "admin" ? null : req.followupEmployee?._id || null);

// Mongo filter for the 3 views: mine | unassigned | team
const viewFilter = (view, myId) => {
  if (view === "unassigned") return { "followup.assignedTo.employeeId": null }; // null or missing
  if (!myId) {
    // admin has no "mine"; "team" = every assigned lead
    return view === "mine" ? { _id: null } : { "followup.assignedTo.employeeId": { $ne: null } };
  }
  if (view === "mine") return { "followup.assignedTo.employeeId": myId };
  return { "followup.assignedTo.employeeId": { $nin: [null, myId] } }; // team = assigned to someone else
};

// Only the owner (or admin) may update a lead.
const ownershipError = (c, req) => {
  if (req.user?.role === "admin") return null;
  const ownerId = c.followup?.assignedTo?.employeeId;
  if (!ownerId) return "Take this lead first, then update it.";
  if (String(ownerId) !== String(req.followupEmployee._id)) {
    return `This lead is handled by ${c.followup.assignedTo.name || "another employee"}.`;
  }
  return null;
};

// GET /api/loan-followup/list?tab=pending|completed&view=mine|unassigned|team&search=
router.get("/list", auth, canManageLoanFollowup, async (req, res) => {
  try {
    const tab = req.query.tab === "completed" ? "COMPLETED" : "PENDING";
    const view = ["mine", "unassigned", "team"].includes(req.query.view) ? req.query.view : "mine";
    const myId = myIdOf(req);

    const filter = { "followup.status": tab, ...viewFilter(view, myId) };
    if (req.query.search) {
      filter.$or = [
        { customerName: { $regex: req.query.search, $options: "i" } },
        { contactNo: { $regex: req.query.search, $options: "i" } },
      ];
    }

    const rows = await LoanCustomer.find(filter)
      .select(CUSTOMER_FIELDS) // documents & checklist are NOT selected
      .sort(tab === "COMPLETED" ? { "followup.completedAt": -1 } : { "followup.handedOverAt": -1 })
      .lean();

    const data = rows.map((c) => ({
      ...c,
      isMine: !!myId && String(c.followup?.assignedTo?.employeeId || "") === String(myId),
    }));

    const [pending, completed, mine, unassigned, team] = await Promise.all([
      LoanCustomer.countDocuments({ "followup.status": "PENDING" }),
      LoanCustomer.countDocuments({ "followup.status": "COMPLETED" }),
      LoanCustomer.countDocuments({ "followup.status": tab, ...viewFilter("mine", myId) }),
      LoanCustomer.countDocuments({ "followup.status": tab, ...viewFilter("unassigned", myId) }),
      LoanCustomer.countDocuments({ "followup.status": tab, ...viewFilter("team", myId) }),
    ]);

    res.json({
      success: true,
      data,
      counts: { pending, completed },
      viewCounts: { mine, unassigned, team },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/loan-followup/:id/claim  — employee takes an unassigned pending lead.
// Atomic: if two people click at the same moment, only one gets it.
router.post("/:id/claim", auth, canManageLoanFollowup, async (req, res) => {
  try {
    const emp = req.followupEmployee;
    if (!emp) {
      return res.status(400).json({
        success: false,
        message: "Admin can't take leads — use 'Handled by' on the admin Loan Process page.",
      });
    }

    const claimed = await LoanCustomer.findOneAndUpdate(
      { _id: req.params.id, "followup.status": "PENDING", "followup.assignedTo.employeeId": null },
      {
        $set: {
          "followup.assignedTo.employeeId": emp._id,
          "followup.assignedTo.name": emp.name,
          "followup.assignedTo.assignedAt": new Date(),
        },
      },
      { new: true }
    ).select(CUSTOMER_FIELDS);

    if (!claimed) {
      const c = await LoanCustomer.findById(req.params.id).select("followup.status followup.assignedTo");
      if (!c) return res.status(404).json({ success: false, message: "Customer not found" });
      if (c.followup?.assignedTo?.employeeId) {
        return res.status(409).json({
          success: false,
          message: `Already taken by ${c.followup.assignedTo.name || "another employee"}.`,
        });
      }
      return res.status(400).json({ success: false, message: "This lead is not in the pending list." });
    }

    res.json({ success: true, customer: claimed });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/loan-followup/:id/release — owner (or admin) gives the lead back to Unassigned.
router.post("/:id/release", auth, canManageLoanFollowup, async (req, res) => {
  try {
    const c = await LoanCustomer.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Customer not found" });
    if (c.followup.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "Only pending leads can be released." });
    }
    const err = ownershipError(c, req);
    if (err) return res.status(403).json({ success: false, message: err });

    c.followup.assignedTo = { employeeId: null, name: "", assignedAt: null };
    c.markModified("followup");
    await c.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

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
    const ownErr = ownershipError(c, req);
    if (ownErr) return res.status(403).json({ success: false, message: ownErr });

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
    const ownErr = ownershipError(c, req);
    if (ownErr) return res.status(403).json({ success: false, message: ownErr });

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