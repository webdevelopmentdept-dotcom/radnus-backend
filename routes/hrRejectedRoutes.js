const express = require("express");
const router = express.Router();

const Employee = require("../models/Employee");
const Document = require("../models/Document");
const logAction = require("../helpers/logAction");

const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");

// ================= RE-APPROVE (OPTIONAL 🔥) =================
router.put("/reapprove/:id", auth, hrOnly, async (req, res) => {
  try {

    await Employee.findByIdAndUpdate(req.params.id, {
      status: "approved",
      remarks: ""
    });

    const emp = await Employee.findByIdAndUpdate(req.params.id, { status: "approved", remarks: "" });
    await logAction(req, { action: "EMPLOYEE_REAPPROVE", entityType: "Employee", entityId: req.params.id, entityName: emp?.name || "" });

    res.json({ message: "Employee approved again ✅" });

  } catch (err) {
    res.status(500).json({ message: "Re-approve failed" });
  }
});


// ================= MOVE BACK TO PENDING (OPTIONAL 🔁) =================
router.put("/move-to-pending/:id", auth, hrOnly, async (req, res) => {
  try {

    await Employee.findByIdAndUpdate(req.params.id, {
      status: "pending",
      remarks: ""
    });

    const emp = await Employee.findByIdAndUpdate(req.params.id, { status: "pending", remarks: "" });
    await logAction(req, { action: "EMPLOYEE_MOVE_TO_PENDING", entityType: "Employee", entityId: req.params.id, entityName: emp?.name || "" });

    res.json({ message: "Moved to pending ⏳" });

  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
});

module.exports = router;