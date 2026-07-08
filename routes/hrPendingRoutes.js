const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const { createNotification } = require("../helpers/notificationHelper"); // ✅ ADD THIS IMPORT


// ================= PENDING =================
router.get("/pending", async (req, res) => {
  try {

    const employees = await Employee.find({
      status: "pending" // ✅ IMPORTANT
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
router.put("/approve/:id", async (req, res) => {
  try {
    // ✅ CHANGE 1: { new: true } add pannanum, employee updated data (name) kittum
    const employee = await Employee.findByIdAndUpdate(req.params.id, {
      status: "approved",
      remarks: "",
      reuploaded: false,
      updatedAt: new Date()
    }, { new: true });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // ✅ CHANGE 2: Activation route-la irundhu same maadhiri notification create panrom
    await createNotification({
      recipient_id:   employee._id,
      recipient_role: "employee",
      type:           "employee_activated",
      title:          "Application Approved 🎉",
      message:        `Congratulations ${employee.name}! Your application has been approved. Welcome aboard!`,
      link:           "/employee/dashboard"
    });

    res.json({ message: "Approved successfully" });

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
      updatedAt: new Date()
    }, { new: true }); // ✅ optional: reject-kum notification venumna intha data use pannalam

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