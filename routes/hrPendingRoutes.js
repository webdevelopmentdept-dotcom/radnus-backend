const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const { createNotification } = require("../helpers/notificationHelper"); // ✅ ADD THIS IMPORT
const logAction = require("../helpers/logAction");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");
const EmploymentDetails = require("../models/EmploymentDetails");

// ================= PENDING =================
router.get("/pending", auth, hrOnly, async (req, res) => {
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
router.get("/rejected", auth, hrOnly, async (req, res) => {
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

// ================= APPROVE (HR STEP) =================
router.put("/approve/:id", auth, hrOnly, async (req, res) => {
  try {
    const { remarks } = req.body;

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
      recipient_id: null,
      recipient_role: "admin",
      type: "general",
      title: "New HR Approval Pending",
      message: `${employee.name}'s application has been approved by HR and is waiting for your approval.`,
      link: "/admin/pending-approvals"
    });

    await logAction(req, {
      action: "EMPLOYEE_APPROVE", entityType: "Employee",
      entityId: employee._id, entityName: employee.name, remarks: remarks || "",
    });

    res.json({ message: "Sent for Admin approval" });

  } catch (err) {
    console.error("Approve error:", err);
    res.status(500).json({ message: "Approve error" });
  }
});

// ================= REJECT =================
router.put("/reject/:id", auth, hrOnly, async (req, res) => {
  try {
    const { remarks } = req.body;

    const employee = await Employee.findByIdAndUpdate(req.params.id, {
      status: "rejected",
      remarks: remarks || "Rejected by HR",
      hrRemarks: remarks || "Rejected by HR",
      updatedAt: new Date()
    }, { new: true });

    if (!employee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    await logAction(req, {
      action: "EMPLOYEE_REJECT", entityType: "Employee",
      entityId: employee._id, entityName: employee.name, remarks: remarks || "",
    });


    res.json({ message: "Rejected successfully" });

  } catch (err) {
    res.status(500).json({ message: "Reject error" });
  }
});

// ================= APPROVED =================
router.get("/approved", auth, hrOnly, async (req, res) => {
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
          staffType: emp.staffType || "hrms",
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
router.get("/employees", auth, hrOnly, async (req, res) => {
  try {
    const employees = await Employee.find();

    // Date of joining from Employment Details (HR activation form)
    const empDetails = await EmploymentDetails
      .find({ employee_id: { $in: employees.map((e) => e._id) } })
      .select("employee_id employment.date_of_joining")
      .lean();
    const dojMap = {};
    empDetails.forEach((d) => {
      dojMap[String(d.employee_id)] = d.employment?.date_of_joining || null;
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
          reuploaded: emp.reuploaded,
          documentsCompleted: emp.documentsCompleted,
          exitType: emp.exitType,
          accessDeactivated: emp.accessDeactivated,
          createdAt: emp.createdAt,
          joiningDate: dojMap[String(emp._id)] || null,      // joining date illa, so idha use panrom
          relievingDate: emp.relievingDate,
          exitCategory: emp.exitCategory,
          exitReason: emp.exitReason,
          noticePeriodServed: emp.noticePeriodServed,
          rehireEligible: emp.rehireEligible,
          relievedAt: emp.relievedAt,
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