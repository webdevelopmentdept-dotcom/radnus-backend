const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const { createNotification } = require("../helpers/notificationHelper");

// ================= ADMIN PENDING LIST =================
router.get("/pending", async (req, res) => {
  try {
    const employees = await Employee.find({ status: "admin_pending" });

    const result = await Promise.all(
      employees.map(async (emp) => {
        const docs = await Document.find({ employeeId: emp._id });
        return {
          _id: emp._id,
          employeeId: emp.employeeId,
          name: emp.name,
          email: emp.email,
          mobile: emp.mobile,
          department: emp.department,
          designation: emp.designation,
          status: emp.status,
          remarks: emp.remarks,
          createdAt: emp.createdAt,
          updatedAt: emp.updatedAt,
          documents: docs
        };
      })
    );

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching admin pending data" });
  }
});

// ================= ADMIN APPROVE (FINAL) =================
router.put("/approve/:id", async (req, res) => {
  try {
    const employee = await Employee.findByIdAndUpdate(req.params.id, {
      status: "approved",
      remarks: "",
      updatedAt: new Date()
    }, { new: true });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    await createNotification({
      recipient_id:   employee._id,
      recipient_role: "employee",
      type:           "employee_activated",
      title:          "Application Approved 🎉",
      message:        `Congratulations ${employee.name}! Your application has been fully approved. Welcome aboard!`,
      link:           "/employee/dashboard"
    });

    res.json({ message: "Approved successfully" });
  } catch (err) {
    console.error("Admin approve error:", err);
    res.status(500).json({ message: "Approve error" });
  }
});

// ================= ADMIN REJECT =================
router.put("/reject/:id", async (req, res) => {
  try {
    const { remarks } = req.body;

    const employee = await Employee.findByIdAndUpdate(req.params.id, {
      status: "rejected",
      remarks: remarks || "Rejected by Admin",
      updatedAt: new Date()
    }, { new: true });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json({ message: "Rejected successfully" });
  } catch (err) {
    console.error("Admin reject error:", err);
    res.status(500).json({ message: "Reject error" });
  }
});

module.exports = router;