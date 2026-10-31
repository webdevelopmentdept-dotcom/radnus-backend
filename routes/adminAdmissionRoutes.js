const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
router.use(auth, adminOnly);

const Employee = require("../models/Employee");
const AdmissionStudent = require("../models/AdmissionStudent");
const AdmissionCourse = require("../models/AdmissionCourse");
const AdmissionSettings = require("../models/AdmissionSettings");

// ══════════════════════════════════════════════════════
//  GET /api/admin-admission/metrics
// ══════════════════════════════════════════════════════
router.get("/metrics", async (req, res) => {
  try {
    const [byStatus, money, byStaff] = await Promise.all([
      AdmissionStudent.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      AdmissionStudent.aggregate([
        { $match: { status: { $ne: "DRAFT" } } },
        { $group: { _id: null, totalFees: { $sum: "$totalFees" }, collected: { $sum: "$paidAmount" }, balance: { $sum: "$balance" } } },
      ]),
      AdmissionStudent.aggregate([
        { $match: { status: { $ne: "DRAFT" } } },
        { $group: { _id: "$staffName", applications: { $sum: 1 }, totalFees: { $sum: "$totalFees" }, collected: { $sum: "$paidAmount" } } },
        { $sort: { applications: -1 } },
      ]),
    ]);
    const c = (st) => byStatus.find((x) => x._id === st)?.count || 0;
    res.json({
      success: true,
      data: {
        drafts: c("DRAFT"),
        completed: c("APPLICATION_COMPLETED"),
        fullyCompleted: c("FULLY_COMPLETED"),
        totalFees: money[0]?.totalFees || 0,
        collected: money[0]?.collected || 0,
        balance: money[0]?.balance || 0,
        byTelecaller: byStaff.map((x) => ({ name: x._id, applications: x.applications, totalFees: x.totalFees, collected: x.collected })),
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/admin-admission/all?status=&staffId=&search=&from=&to=
router.get("/all", async (req, res) => {
  try {
    const q = req.query;
    const filter = {};
    if (q.status) filter.status = q.status;
    if (q.staffId) filter.staffId = q.staffId;
    if (q.search) {
      const rx = { $regex: String(q.search).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
      filter.$or = [{ fullName: rx }, { mobileNo: rx }, { applicationNo: rx }, { shopName: rx }];
    }
    if (q.from || q.to) {
      filter.applicationDate = {};
      if (q.from) filter.applicationDate.$gte = new Date(q.from);
      if (q.to) filter.applicationDate.$lte = new Date(new Date(q.to).setHours(23, 59, 59, 999));
    }
    const data = await AdmissionStudent.find(filter).sort({ updatedAt: -1 });
    res.json({ success: true, data, total: data.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  ACCESS TOGGLES (same pattern as admin-loan-process)
// ══════════════════════════════════════════════════════
router.get("/access/employees", async (req, res) => {
  try {
    const filter = {};
    if (req.query.search) filter.name = { $regex: req.query.search, $options: "i" };
    if (req.query.department) filter.department = req.query.department;
    const employees = await Employee.find(filter)
      .select("name email department canManageAdmission admissionReportAccess")
      .sort({ name: 1 });
    res.json({ success: true, data: employees });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

const toggle = (field) => async (req, res) => {
  try {
    const emp = await Employee.findByIdAndUpdate(
      req.params.id,
      { [field]: !!req.body.enabled },
      { new: true }
    ).select(`name ${field}`);
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
    res.json({ success: true, data: emp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
router.patch("/access/:id", toggle("canManageAdmission"));
router.patch("/access/:id/report-access", toggle("admissionReportAccess"));

// ══════════════════════════════════════════════════════
//  SETTINGS — Register No (copied onto NEW applications only)
// ══════════════════════════════════════════════════════
router.get("/settings", async (req, res) => {
  try {
    const s = await AdmissionSettings.getSingleton();
    res.json({ success: true, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const registerNo = String(req.body.registerNo || "").trim();
    if (!registerNo) return res.status(400).json({ success: false, message: "Register No is required" });
    await AdmissionSettings.getSingleton();
    const s = await AdmissionSettings.findOneAndUpdate(
      { key: "default" },
      { registerNo, updatedByName: "Admin" },
      { new: true }
    );
    res.json({ success: true, data: s });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  FEE MASTER
//  Changing a fee affects NEW applications only (students keep their snapshot)
// ══════════════════════════════════════════════════════
router.get("/courses", async (req, res) => {
  try {
    await AdmissionCourse.ensureSeeded();
    const data = await AdmissionCourse.find().sort({ order: 1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.post("/courses", async (req, res) => {
  try {
    const { name, category, feeWithout, feeWith, order } = req.body;
    if (!name || feeWithout == null) return res.status(400).json({ success: false, message: "Name and fee are required" });
    const key = String(name).toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
    const doc = await AdmissionCourse.create({
      key: `${category === "SCHEME" ? "SCHEME_" : ""}${key}`,
      name,
      category: category === "SCHEME" ? "SCHEME" : "REGULAR",
      feeWithout: Number(feeWithout),
      feeWith: feeWith === "" || feeWith == null ? null : Number(feeWith),
      order: Number(order) || 99,
    });
    res.status(201).json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.code === 11000 ? "Course already exists" : err.message });
  }
});

router.put("/courses/:id", async (req, res) => {
  try {
    const upd = {};
    ["name", "order", "active"].forEach((k) => { if (req.body[k] !== undefined) upd[k] = req.body[k]; });
    if (req.body.feeWithout !== undefined) upd.feeWithout = Number(req.body.feeWithout);
    if (req.body.feeWith !== undefined) upd.feeWith = req.body.feeWith === "" || req.body.feeWith == null ? null : Number(req.body.feeWith);
    const doc = await AdmissionCourse.findByIdAndUpdate(req.params.id, upd, { new: true });
    if (!doc) return res.status(404).json({ success: false, message: "Course not found" });
    res.json({ success: true, data: doc });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

module.exports = router;