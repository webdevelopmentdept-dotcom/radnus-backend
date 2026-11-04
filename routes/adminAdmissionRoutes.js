const express = require("express");
const router = express.Router();
const auth = require("../middleware/auth");
const adminOnly = require("../middleware/adminOnly");
router.use(auth, adminOnly);

const Employee = require("../models/Employee");
const AdmissionStudent = require("../models/AdmissionStudent");
const AdmissionCourse = require("../models/AdmissionCourse");
const AdmissionSettings = require("../models/AdmissionSettings");
const ExcelJS = require("exceljs");

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
        {
          $group: {
            _id: "$staffId",
            name: { $first: "$staffName" },
            applications: { $sum: 1 },
            fullyCompleted: { $sum: { $cond: [{ $eq: ["$status", "FULLY_COMPLETED"] }, 1, 0] } },
            totalFees: { $sum: "$totalFees" },
            collected: { $sum: "$paidAmount" },
          }
        },
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
        byTelecaller: byStaff.map((x) => ({
          staffId: x._id,
          name: x.name,
          applications: x.applications,
          fullyCompleted: x.fullyCompleted,
          totalFees: x.totalFees,
          collected: x.collected,
        })),
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
// ══════════════════════════════════════════════════════
//  GET /api/admin-admission/export?status=&search=&from=&to=
// ══════════════════════════════════════════════════════
router.get("/export", async (req, res) => {
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

    const students = await AdmissionStudent.find(filter).sort({ applicationDate: -1 }).lean();

    const D = (d) => (d ? new Date(d).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" }) : "");
    const DT = (d) =>
      d ? new Date(d).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour12: true }) : "";
    const STATUS = { DRAFT: "Draft", APPLICATION_COMPLETED: "Application Completed", FULLY_COMPLETED: "Fully Completed" };
    const PAY = { PENDING: "Payment Pending", PARTIAL: "Partial", PAID: "Paid" };

    const wb = new ExcelJS.Workbook();
    wb.creator = "Radnus Connect";
    wb.created = new Date();

    const styleHeader = (ws) => {
      const h = ws.getRow(1);
      h.font = { bold: true, color: { argb: "FFFFFFFF" } };
      h.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2A3EB1" } };
      h.alignment = { vertical: "middle", horizontal: "left" };
      h.height = 20;
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
    };

    // ── Sheet 1: Admissions ──
    const ws = wb.addWorksheet("Admissions", { views: [{ state: "frozen", ySplit: 1 }] });
    ws.columns = [
      { header: "Application No", key: "applicationNo", width: 20 },
      { header: "Register No", key: "registerNo", width: 14 },
      { header: "Batch No", key: "batchNo", width: 12 },
      { header: "Bill No", key: "billNo", width: 12 },
      { header: "Application Date", key: "applicationDate", width: 16 },
      { header: "BDA (Telecaller)", key: "staffName", width: 20 },
      { header: "Student Name", key: "fullName", width: 26 },
      { header: "Mobile", key: "mobileNo", width: 15 },
      { header: "Email", key: "email", width: 26 },
      { header: "Emergency Mobile", key: "emergencyMobile", width: 16 },
      { header: "Gender", key: "gender", width: 10 },
      { header: "Date of Birth", key: "dateOfBirth", width: 14 },
      { header: "Blood Group", key: "bloodGroup", width: 12 },
      { header: "Differently Abled", key: "differentlyAbled", width: 16 },
      { header: "Aadhaar No", key: "aadhaarNo", width: 16 },
      { header: "Shop Name", key: "shopName", width: 22 },
      { header: "Address", key: "postalAddress", width: 34 },
      { header: "District", key: "district", width: 16 },
      { header: "State", key: "state", width: 14 },
      { header: "Pincode", key: "pincode", width: 10 },
      { header: "Course", key: "course", width: 24 },
      { header: "Scheme", key: "scheme", width: 24 },
      { header: "Accommodation", key: "accommodation", width: 16 },
      { header: "Mode of Course", key: "modeOfCourse", width: 14 },
      { header: "Hybrid Note", key: "hybridNote", width: 20 },
      { header: "Timing", key: "timing", width: 14 },
      { header: "Date of Joining", key: "dateOfJoining", width: 14 },
      { header: "Qualification", key: "academic", width: 18 },
      { header: "Course Fee (₹)", key: "courseFee", width: 14 },
      { header: "Discount (₹)", key: "discount", width: 12 },
      { header: "Total Fees (₹)", key: "totalFees", width: 14 },
      { header: "Paid (₹)", key: "paidAmount", width: 12 },
      { header: "Balance (₹)", key: "balance", width: 12 },
      { header: "Payment Status", key: "paymentStatus", width: 16 },
      { header: "Status", key: "status", width: 22 },
      { header: "Application Completed At", key: "completedAt", width: 22 },
      { header: "Fully Completed At", key: "fullyCompletedAt", width: 22 },
      { header: "Email Status", key: "emailStatus", width: 14 },
      { header: "Email Sent At", key: "emailSentAt", width: 22 },
      { header: "Photo Uploaded", key: "photo", width: 14 },
      { header: "Aadhaar Uploaded", key: "aadhaarDoc", width: 16 },
      { header: "Created At", key: "createdAt", width: 22 },
      { header: "Last Updated", key: "updatedAt", width: 22 },
    ];
    students.forEach((s) => {
      ws.addRow({
        applicationNo: s.applicationNo || "Draft",
        registerNo: s.registerNo || "",
        batchNo: s.batchNo || "",
        billNo: s.billNo || "",
        applicationDate: D(s.applicationDate),
        staffName: s.staffName || "",
        fullName: s.fullName || "",
        mobileNo: s.mobileNo || "",
        email: s.email || "",
        emergencyMobile: s.emergencyMobile || "",
        gender: s.gender || "",
        dateOfBirth: D(s.dateOfBirth),
        bloodGroup: s.bloodGroup || "",
        differentlyAbled: s.differentlyAbled || "",
        aadhaarNo: s.aadhaarNo || "",
        shopName: s.shopName || "",
        postalAddress: s.postalAddress || "",
        district: s.district || "",
        state: s.state || "",
        pincode: s.pincode || "",
        course: s.course?.name || "",
        scheme: s.scheme?.name || "",
        accommodation: s.scheme?.name ? "" : s.accommodation === "WITH" ? "With" : "Without",
        modeOfCourse: s.modeOfCourse || "",
        hybridNote: s.hybridNote || "",
        timing: s.timing || "",
        dateOfJoining: D(s.dateOfJoining),
        academic: s.academic?.level === "Others" ? `Others: ${s.academic?.others || ""}` : s.academic?.level || "",
        courseFee: s.courseFee || 0,
        discount: s.discount || 0,
        totalFees: s.totalFees || 0,
        paidAmount: s.paidAmount || 0,
        balance: s.balance || 0,
        paymentStatus: s.status === "DRAFT" ? "" : PAY[s.paymentStatus] || "",
        status: STATUS[s.status] || s.status,
        completedAt: DT(s.completedAt),
        fullyCompletedAt: DT(s.fullyCompletedAt),
        emailStatus: s.emailStatus === "SENT" ? "Sent" : s.emailStatus === "FAILED" ? "Failed" : "Not sent",
        emailSentAt: DT(s.emailSentAt),
        photo: s.documents?.photo?.url ? "Yes" : "No",
        aadhaarDoc: s.documents?.aadhaar?.url ? "Yes" : "No",
        createdAt: DT(s.createdAt),
        updatedAt: DT(s.updatedAt),
      });
    });
    ["courseFee", "discount", "totalFees", "paidAmount", "balance"].forEach((k) => {
      ws.getColumn(k).numFmt = "₹#,##0";
    });
    styleHeader(ws);

    // ── Sheet 2: Payments (one row per payment) ──
    const ps = wb.addWorksheet("Payments", { views: [{ state: "frozen", ySplit: 1 }] });
    ps.columns = [
      { header: "Application No", key: "applicationNo", width: 20 },
      { header: "Student Name", key: "fullName", width: 26 },
      { header: "BDA", key: "staffName", width: 18 },
      { header: "Paid Date", key: "paidDate", width: 14 },
      { header: "Payment Type", key: "type", width: 18 },
      { header: "Amount (₹)", key: "amount", width: 14 },
      { header: "Mode", key: "mode", width: 10 },
      { header: "Ref No", key: "refNo", width: 20 },
      { header: "Received By", key: "receivedByName", width: 20 },
      { header: "Recorded At", key: "createdAt", width: 22 },
    ];
    students.forEach((s) =>
      (s.payments || []).forEach((p) =>
        ps.addRow({
          applicationNo: s.applicationNo || "Draft",
          fullName: s.fullName,
          staffName: s.staffName,
          paidDate: D(p.paidDate),
          type: p.type || "",
          amount: p.amount || 0,
          mode: p.mode || "",
          refNo: p.refNo || "",
          receivedByName: p.receivedByName || "",
          createdAt: DT(p.createdAt),
        })
      )
    );
    ps.getColumn("amount").numFmt = "₹#,##0";
    styleHeader(ps);

    // ── Sheet 3: Telecaller Summary ──
    const map = {};
    students.filter((s) => s.status !== "DRAFT").forEach((s) => {
      const k = String(s.staffId);
      if (!map[k]) map[k] = { name: s.staffName, applications: 0, fully: 0, fees: 0, collected: 0, balance: 0 };
      map[k].applications += 1;
      if (s.status === "FULLY_COMPLETED") map[k].fully += 1;
      map[k].fees += s.totalFees || 0;
      map[k].collected += s.paidAmount || 0;
      map[k].balance += s.balance || 0;
    });
    const ts = wb.addWorksheet("Telecaller Summary", { views: [{ state: "frozen", ySplit: 1 }] });
    ts.columns = [
      { header: "Rank", key: "rank", width: 8 },
      { header: "Telecaller", key: "name", width: 24 },
      { header: "Applications", key: "applications", width: 14 },
      { header: "Fully Completed", key: "fully", width: 16 },
      { header: "Total Fees (₹)", key: "fees", width: 16 },
      { header: "Collected (₹)", key: "collected", width: 16 },
      { header: "Balance (₹)", key: "balance", width: 16 },
    ];
    Object.values(map)
      .sort((a, b) => b.applications - a.applications)
      .forEach((r, i) => ts.addRow({ rank: i + 1, ...r }));
    ["fees", "collected", "balance"].forEach((k) => (ts.getColumn(k).numFmt = "₹#,##0"));
    styleHeader(ts);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="admissions-${new Date().toISOString().slice(0, 10)}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("ADMISSION EXPORT ERROR", err);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;