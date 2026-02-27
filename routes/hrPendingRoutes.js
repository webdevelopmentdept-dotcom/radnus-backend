const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");


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
    await Employee.findByIdAndUpdate(req.params.id, {
      status: "approved",
      remarks: "",
       reuploaded: false ,
      updatedAt: new Date()
    });

    res.json({ message: "Approved successfully" });

  } catch (err) {
    res.status(500).json({ message: "Approve error" });
  }
});


// ================= REJECT =================
router.put("/reject/:id", async (req, res) => {
  try {
    const { remarks } = req.body;

    await Employee.findByIdAndUpdate(req.params.id, {
      status: "rejected",
      remarks: remarks || "Rejected by HR",
      updatedAt: new Date()
    });

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