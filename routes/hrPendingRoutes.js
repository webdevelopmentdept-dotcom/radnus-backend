const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const { createNotification } = require("../helpers/notificationHelper"); // ✅ ADD THIS IMPORT


// ================= PENDING =================
router.get("/pending", async (req, res) => {
  try {

    const employees = await Employee.find({
     status: { $in: ["pending", "admin_pending"] }
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
          status: emp.status,
          remarks: emp.remarks,
          hrRemarks: emp.hrRemarks,
          mdRemarks: emp.mdRemarks,
          reuploaded: emp.reuploaded,
          createdAt: emp.createdAt,
          updatedAt: emp.updatedAt,
          documents: docs
        };
      })
    );

    res.json(result);

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Error fetching pending data" });
  }
});


// ================= REJECTED =================
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
          status: emp.status,
          remarks: emp.remarks, // ✅ FIXED
            hrRemarks: emp.hrRemarks,
          mdRemarks: emp.mdRemarks,
          reuploaded: emp.reuploaded,
          createdAt: emp.createdAt,
          updatedAt: emp.updatedAt,
          documents: docs
        };
      })
    );

    res.json(result);

  } catch (err) {
    res.status(500).json({ message: "Error fetching rejected employees" });
  }
});


// ================= APPROVE =================
// ================= APPROVE (HR STEP) =================
router.put("/approve/:id", async (req, res) => {
  try {
    const { remarks } = req.body;   // ✅ இது சேர்க்கணும்

    const employee = await Employee.findByIdAndUpdate(req.params.id, {
      status: "admin_pending",
      remarks: "",
      hrRemarks: remarks || "",
      reuploaded: false,
      updatedAt: new Date()
    }, { new: true });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    await createNotification({
      recipient_id:   null,
      recipient_role: "admin",
      type:           "general",
      title:          "New HR Approval Pending",
      message:        `${employee.name}'s application has been approved by HR and is waiting for your approval.`,
      link:           "/admin/pending-approvals"
    });

    res.json({ message: "Sent for Admin approval" });

  } catch (err) {
    console.error("Approve error:", err);
    res.status(500).json({ message: "Approve error" });
  }
});

// ================= REJECT =================
router.put("/reject/:id", async (req, res) => {
  try {
    const { remarks } = req.body;

        const employee = await Employee.findByIdAndUpdate(req.params.id, {
      status: "rejected",
      remarks: remarks || "Rejected by HR",
      hrRemarks: remarks || "Rejected by HR",   // ✅ add பண்ணுங்க
      updatedAt: new Date()
    }, { new: true });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // ⚪ Reject-ku notification venumna, idha uncomment pannunga:
    // await createNotification({
    //   recipient_id:   employee._id,
    //   recipient_role: "employee",
    //   type:           "system",
    //   title:          "Application Update",
    //   message:        `Hi ${employee.name}, your application needs some corrections. Reason: ${employee.remarks}`,
    //   link:           "/employee/dashboard"
    // });

    res.json({ message: "Rejected successfully" });

  } catch (err) {
    res.status(500).json({ message: "Reject error" });
  }
});

// ================= APPROVED =================
router.get("/approved", async (req, res) => {
  try {
    const employees = await Employee.find({
      status: "approved"
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
          essl_id: emp.essl_id || null,
          hrRemarks: emp.hrRemarks,
          mdRemarks: emp.mdRemarks,
          reuploaded: emp.reuploaded,   // 🔥 ADD THIS LINE
          documents: docs
        };
      })
    );

    res.json(result);

  } catch (err) {
    res.status(500).json({ message: "Error fetching approved employees" });
  }
});

// ================= ALL EMPLOYEES =================
router.get("/employees", async (req, res) => {
  try {
    const employees = await Employee.find();

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
          status: emp.status,
          reuploaded: emp.reuploaded,
          documentsCompleted: emp.documentsCompleted,
           exitType: emp.exitType,
          accessDeactivated: emp.accessDeactivated,
          documents: docs
        };
      })
    );

    res.json(result);

  } catch (err) {
    res.status(500).json({ message: "Error fetching employees" });
  }
});

module.exports = router;