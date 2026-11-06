const express = require("express");
const router = express.Router();
const LoanCustomer = require("../models/LoanCustomer");
const Employee = require("../models/Employee");
const auth = require("../middleware/auth");
const ExcelJS = require("exceljs");

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
  "communicationAddress unitAddress fatherName fatherOccupation maritalStatus spouseName spouseOccupation bankName ifscCode staffName followup createdAt";

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

// DIC / Bank stage filter.  dic = PENDING|REJECTED|FORWARDED,  bank = PENDING|PROCESS|SANCTIONED|REJECTED
// "Pending" also matches leads where nothing has been selected yet (state missing / empty).
// Bank filter only makes sense after DIC is Forwarded, so it adds that condition automatically.
const stageConditions = (dic, bank) => {
  const D = ["PENDING", "REJECTED", "FORWARDED"];
  const B = ["PENDING", "PROCESS", "SANCTIONED", "REJECTED"];
  const conds = [];
  if (D.includes(dic)) {
    conds.push({ "followup.dicOffice.state": dic === "PENDING" ? { $in: ["PENDING", "", null] } : dic });
  }
  if (B.includes(bank)) {
    conds.push({ "followup.dicOffice.state": { $in: ["FORWARDED", "COMPLETED"] } });
    conds.push({ "followup.bank.state": bank === "PENDING" ? { $in: ["PENDING", "", null] } : bank });
  }
  return conds;
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

const fmtDate = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return isNaN(x) ? "" : x.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }); // dd/mm/yyyy
};
const fmtState = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase().replace("_", " ") : "");

// GET /api/loan-followup/list?tab=pending|completed&view=mine|unassigned|team&search=&dic=&bank=
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
    const stageConds = stageConditions(req.query.dic, req.query.bank);
    if (stageConds.length) filter.$and = stageConds;

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

// GET /api/loan-followup/export?tab=&view=&search=&staff=&dic=&bank=
router.get("/export", auth, canManageLoanFollowup, async (req, res) => {
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
    const stageConds = stageConditions(req.query.dic, req.query.bank);
    if (stageConds.length) filter.$and = stageConds;
    if (req.query.staff) filter.staffName = req.query.staff;

    const rows = await LoanCustomer.find(filter)
      .select(CUSTOMER_FIELDS)
      .sort(tab === "COMPLETED" ? { "followup.completedAt": -1 } : { "followup.handedOverAt": -1 })
      .lean();

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Loan Followup");
    ws.columns = [
      { header: "SL.NO", key: "sl", width: 7 },
      { header: "Customer Name", key: "name", width: 24 },
      { header: "Contact No", key: "contact", width: 15 },
      { header: "Mail ID", key: "mail", width: 28 },
      { header: "Telecaller", key: "staff", width: 18 },
      { header: "Loan Date", key: "loanDate", width: 12 },
      { header: "Handed Over Date", key: "handed", width: 16 },
      { header: "Business Type", key: "biz", width: 28 },
      { header: "Scheme", key: "scheme", width: 10 },
      { header: "Loan Value (₹)", key: "value", width: 15 },
      { header: "Bank Name", key: "bank", width: 22 },
      { header: "IFSC Code", key: "ifsc", width: 14 },
      { header: "DIC Office Status", key: "dicState", width: 16 },
      { header: "DIC Office Reason", key: "dicReason", width: 32 },
      { header: "DIC Updated Date", key: "dicDate", width: 16 },
      { header: "Bank Status", key: "bankState", width: 14 },
      { header: "Bank Reason", key: "bankReason", width: 32 },
      { header: "Bank Updated Date", key: "bankDate", width: 16 },
      { header: "Last Updated Date", key: "last", width: 16 },
      { header: "Full Reason History", key: "history", width: 60 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];

    rows.forEach((c, i) => {
      const f = c.followup || {};
      const dic = f.dicOffice || {};
      const bank = f.bank || {};
      const times = [dic.updatedAt, bank.updatedAt].filter(Boolean).map((d) => new Date(d).getTime());
      const last = times.length ? new Date(Math.max(...times)) : null;

      const history = (f.history || [])
        .map((h) => (h.reason || "").trim())
        .filter(Boolean)                                   // reason illatha entries skip
        .filter((r, i, arr) => i === 0 || r !== arr[i - 1]) // thirumba thirumba same reason vandha oru thadava mattum
        .join("\n");

      const row = ws.addRow({
        sl: i + 1,
        name: c.customerName,
        contact: c.contactNo,
        mail: c.mailId || "",
        staff: c.staffName || "",
        loanDate: fmtDate(c.loanDate),
        handed: fmtDate(f.handedOverAt),
        biz: [c.businessType, c.businessSubType].filter(Boolean).join(" - "),
        scheme: c.scheme || "",
        value: c.loanValue || 0,
        bank: c.bankName || "",
        ifsc: c.ifscCode || "",
        dicState: fmtState(dic.state),
        dicReason: dic.reason || "",
        dicDate: fmtDate(dic.updatedAt),
        bankState: fmtState(bank.state),
        bankReason: bank.reason || "",
        bankDate: fmtDate(bank.updatedAt),
        last: fmtDate(last),
        history,
      });
      row.getCell("value").numFmt = "₹#,##,##0";
      row.getCell("history").alignment = { wrapText: true, vertical: "top" };
    });

    const fileName = `loan-followup-${view}-${tab.toLowerCase()}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("FOLLOWUP EXPORT ERROR", err);
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

const DIC_STATES = ["PENDING", "REJECTED", "FORWARDED"];
const BANK_STATES = ["PENDING", "PROCESS", "SANCTIONED", "REJECTED"];
const DIC_DONE = ["FORWARDED", "COMPLETED"];
// PATCH /api/loan-followup/:id/step   Body: { step: "dicOffice"|"bank", state, reason }
// state "" = Clear
router.patch("/:id/step", auth, canManageLoanFollowup, async (req, res) => {
  try {
    const { step, state, reason } = req.body;
    const allowed = step === "dicOffice" ? DIC_STATES : step === "bank" ? BANK_STATES : null;
    if (!allowed) return res.status(400).json({ success: false, message: "Invalid step" });
    if (state !== "" && !allowed.includes(state)) {
      return res.status(400).json({ success: false, message: "Invalid state" });
    }
    const cleanReason = String(reason || "").trim();
    if (state === "REJECTED" && !cleanReason) {
      return res.status(400).json({ success: false, message: "Reason is required when Rejected" });
    }

    const c = await LoanCustomer.findById(req.params.id);
    if (!c) return res.status(404).json({ success: false, message: "Customer not found" });
    if (c.followup.status !== "PENDING") {
      return res.status(400).json({ success: false, message: "This customer is not in the pending list" });
    }
    const ownErr = ownershipError(c, req);
    if (ownErr) return res.status(403).json({ success: false, message: ownErr });

    // Bank unlocks only after DIC Forwarded
    if (step === "bank" && state && !DIC_DONE.includes(c.followup.dicOffice?.state)) {
      return res.status(400).json({ success: false, message: "DIC Office must be Forwarded before Bank Process" });
    }
    // DIC can't be moved away from Forwarded once bank has started
    if (step === "dicOffice" && state !== "FORWARDED" && c.followup.bank?.state) {
      return res.status(400).json({ success: false, message: "Clear the Bank Process first, then change DIC Office" });
    }

    const now = new Date();
    const by = actorName(req);
    c.followup[step] = {
      state,
      reason: state ? cleanReason : "",
      updatedAt: state ? now : null,
      updatedByName: state ? by : "",
    };
    c.followup.history.push({ step, state, reason: cleanReason, at: now, byName: by });

    // Bank Sanctioned = lead Completed (Pending tab -> Completed tab)
    if (step === "bank" && state === "SANCTIONED") {
      c.followup.status = "COMPLETED";
      c.followup.completedAt = now;
    }

    c.markModified("followup");
    await c.save();
    res.json({ success: true, customer: c });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/loan-followup/:id/sanction   Body: { value: ""|"YES"|"NO" }
// value "" = Clear (back to blank)
// router.patch("/:id/sanction", auth, canManageLoanFollowup, async (req, res) => {
//   try {
//     const { value } = req.body;
//     if (!["", "YES", "NO"].includes(value)) {
//       return res.status(400).json({ success: false, message: "Invalid value" });
//     }
//     const c = await LoanCustomer.findById(req.params.id);
//     if (!c) return res.status(404).json({ success: false, message: "Customer not found" });
//     if (c.followup.status !== "PENDING") {
//       return res.status(400).json({ success: false, message: "This customer is not in the pending list" });
//     }
//     const ownErr = ownershipError(c, req);
//     if (ownErr) return res.status(403).json({ success: false, message: ownErr });

//     if (value === "YES") {
//       if (c.followup.dicOffice?.state !== "COMPLETED" || c.followup.bank?.state !== "COMPLETED") {
//         return res.status(400).json({
//           success: false,
//           message: "DIC Office and Bank Process must both be Completed before marking Loan Sanctioned = Yes",
//         });
//       }
//     }

//     c.followup.loanSanctioned = {
//       value,
//       updatedAt: value ? new Date() : null,
//       updatedByName: value ? actorName(req) : "",
//     };
//     // if (value === "YES") {
//     //   c.followup.status = "COMPLETED";   // Pending tab → Completed tab
//     //   c.followup.completedAt = new Date();
//     // }
//     c.markModified("followup");
//     await c.save();
//     res.json({ success: true, customer: c });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

// PATCH /api/loan-followup/:id/complete   Body: { date: "YYYY-MM-DD" }
// router.patch("/:id/complete", auth, canManageLoanFollowup, async (req, res) => {
//   try {
//     const c = await LoanCustomer.findById(req.params.id);
//     if (!c) return res.status(404).json({ success: false, message: "Customer not found" });
//     if (c.followup.status !== "PENDING") {
//       return res.status(400).json({ success: false, message: "This customer is not in the pending list" });
//     }
//     const ownErr = ownershipError(c, req);
//     if (ownErr) return res.status(403).json({ success: false, message: ownErr });

//     if (
//       c.followup.dicOffice?.state !== "COMPLETED" ||
//       c.followup.bank?.state !== "COMPLETED" ||
//       c.followup.loanSanctioned?.value !== "YES"
//     ) {
//       return res.status(400).json({
//         success: false,
//         message: "DIC Office, Bank Process must be Completed and Loan Sanctioned = Yes before submitting.",
//       });
//     }

//     const when = req.body.date ? new Date(req.body.date) : new Date();
//     if (isNaN(when.getTime())) return res.status(400).json({ success: false, message: "Invalid date" });
//     if (when.getTime() > Date.now()) return res.status(400).json({ success: false, message: "Future date is not allowed" });

//     c.followup.status = "COMPLETED";
//     c.followup.completedAt = when;
//     c.markModified("followup");
//     await c.save();
//     res.json({ success: true, customer: c });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });

module.exports = router;