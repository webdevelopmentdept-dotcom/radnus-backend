const express = require("express");
const router = express.Router();

const Employee = require("../models/Employee");
const Document = require("../models/Document");


// ================= GET REJECTED EMPLOYEES =================
router.get("/rejected", async (req, res) => {
  try {

    const employees = await Employee.find({
      status: "rejected"
    });

    const result = await Promise.all(
      employees.map(async (emp) => {

        const docs = await Document.find({
          employeeId: emp._id
        });

        return {
          _id: emp._id,
          employeeId: emp.employeeId,
          name: emp.name,
          email: emp.email,
          mobile: emp.mobile,
          department: emp.department,
          designation: emp.designation,
          remarks: emp.remarks, // 🔥 IMPORTANT
          documents: docs
        };
      })
    );

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching rejected employees" });
  }
});


// ================= RE-APPROVE (OPTIONAL 🔥) =================
router.put("/reapprove/:id", async (req, res) => {
  try {

    await Employee.findByIdAndUpdate(req.params.id, {
      status: "approved",
      remarks: ""
    });

    res.json({ message: "Employee approved again ✅" });

  } catch (err) {
    res.status(500).json({ message: "Re-approve failed" });
  }
});


// ================= MOVE BACK TO PENDING (OPTIONAL 🔁) =================
router.put("/move-to-pending/:id", async (req, res) => {
  try {

    await Employee.findByIdAndUpdate(req.params.id, {
      status: "pending",
      remarks: ""
    });

    res.json({ message: "Moved to pending ⏳" });

  } catch (err) {
    res.status(500).json({ message: "Failed" });
  }
});

module.exports = router;