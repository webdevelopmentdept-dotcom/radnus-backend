const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const Employee = require("../models/Employee");
const EmploymentDetails = require("../models/EmploymentDetails");
const Document = require("../models/Document");
const Attendance = require("../models/Attendance");
const Counter = require("../models/Counter");
const MachineAttendance = require("../models/MachineAttendance");
const MachineUser = require("../models/MachineUser");
const { computeFromPunches, parseShiftMins } = require("../controllers/attendanceController");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");
// "007" -> "7"  (attendance-app same logic use pannudhu)
const norm = (id) =>
  id === null || id === undefined ? null : String(id).trim().replace(/^0+/, "") || "0";
const fmtId = (n) => "STF-" + String(n).padStart(3, "0");

// ── Cloudinary upload (images + pdf) ─────────────────────────
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "hr-documents",
    resource_type: "auto",
    public_id: Date.now() + "-" + file.originalname,
  }),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const ok = ["image/jpeg", "image/png", "image/jpg", "application/pdf"];
    ok.includes(file.mimetype)
      ? cb(null, true)
      : cb(new Error("Invalid file type: " + file.mimetype), false);
  },
});

// ── Old machine punches -> Attendance (idempotent) ───────────
async function migrateMachineAttendance(emp, esslNorm) {
  const ids = [...new Set([esslNorm, String(emp.essl_id)])];
  const recs = await MachineAttendance.find({ essl_id: { $in: ids } }).lean();
  const { startMins, endMins } = parseShiftMins(emp);
  let count = 0;

  for (const r of recs) {
    const punches = (r.punches || []).map((p) => ({
      type: p.type, time: p.time, method: "auto",
    }));
    if (!punches.length) continue;

    const computed = computeFromPunches(punches, startMins, endMins, null, r.date);
    const result = await Attendance.updateOne(
      { employee_id: emp._id, date: r.date },
      { $setOnInsert: { punches, method: "auto", ...computed } },
      { upsert: true }
    );
    if (result.upsertedCount) count++;
  }
  return count;
}

// ── GET: machine-la irukku, aana HRMS employee-ku link aagaadhavanga ──
router.get("/unlinked", auth, hrOnly, async (req, res) => {
  try {
    const emps = await Employee.find({ essl_id: { $nin: [null, ""] } })
      .select("essl_id").lean();
    const linked = new Set(emps.map((e) => norm(e.essl_id)));

    const users = await MachineUser.find().lean();
    const agg = await MachineAttendance.aggregate([
      { $group: { _id: "$essl_id", days: { $sum: 1 }, lastDate: { $max: "$date" } } },
    ]);
    const stats = Object.fromEntries(agg.map((a) => [a._id, a]));
    const names = Object.fromEntries(users.map((u) => [u.essl_id, u.name || ""]));
    const ids = new Set([...users.map((u) => u.essl_id), ...agg.map((a) => a._id)]);

    const data = [...ids]
      .filter((id) => !linked.has(norm(id)))
      .map((id) => ({
        essl_id: id,
        name: names[id] || "",
        punch_days: stats[id]?.days || 0,
        last_punch_date: stats[id]?.lastDate || null,
      }))
      .sort((a, b) => Number(a.essl_id) - Number(b.essl_id));

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET: next staff id + suggested email ─────────────────────
router.get("/next-id", auth, hrOnly, async (req, res) => {
  try {
    const c = await Counter.findOne({ name: "machineStaffId" }).lean();
    const employeeId = fmtId((c?.seq || 0) + 1);
    res.json({ success: true, employeeId, email: `${employeeId.toLowerCase()}@noemail.local` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST: staff create (Employee + EmploymentDetails, direct active) ──
router.post("/", auth, hrOnly, async (req, res) => {
  let emp = null;
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim();
    const mobile = String(b.mobile || "").replace(/\D/g, "").slice(-10);
    const essl = norm(b.essl_id);
    const s = b.salary || {};
    const gross = Number(s.gross_salary) || 0;

    if (!name) return res.status(400).json({ success: false, message: "Name required" });
    if (mobile.length !== 10)
      return res.status(400).json({ success: false, message: "Valid 10-digit mobile required" });
    if (!b.department || !b.designation)
      return res.status(400).json({ success: false, message: "Department & designation required" });
    if (!essl) return res.status(400).json({ success: false, message: "eSSL ID required" });
    if (gross <= 0) return res.status(400).json({ success: false, message: "Gross salary required" });

    // duplicate checks
    const mDup = await Employee.findOne({ mobile: new RegExp(mobile + "$") }).select("name").lean();
    if (mDup)
      return res.status(400).json({ success: false, message: `Mobile already used by ${mDup.name}` });

    const withEssl = await Employee.find({ essl_id: { $nin: [null, ""] } })
      .select("essl_id name").lean();
    const eDup = withEssl.find((e) => norm(e.essl_id) === essl);
    if (eDup)
      return res.status(400).json({ success: false, message: `eSSL ID ${essl} already assigned to ${eDup.name}` });

    const counter = await Counter.findOneAndUpdate(
      { name: "machineStaffId" }, { $inc: { seq: 1 } }, { new: true, upsert: true }
    );
    const employeeId = fmtId(counter.seq);
    const email = String(b.email || "").trim().toLowerCase() || `${employeeId.toLowerCase()}@noemail.local`;

    const eMailDup = await Employee.findOne({ email }).select("name").lean();
    if (eMailDup)
      return res.status(400).json({ success: false, message: `Email already used by ${eMailDup.name}` });

    emp = await Employee.create({
      employeeId, name, email, mobile,
      dob: b.dob || "", address: b.address || "",
      department: b.department, designation: b.designation,
      essl_id: essl,
      status: "active",
      staffType: "machine_staff",
      password: null,
      shift: { start: b.shift_start || "10:00", end: b.shift_end || "19:00" },
    });

    await EmploymentDetails.create({
      employee_id: emp._id,
      employment: {
        employee_code: employeeId,
        designation: b.designation,
        department: b.department,
        employment_type: b.employment_type || "Full-time",
        date_of_joining: b.date_of_joining || "",
        work_shift: "General Shift",
      },
      salary: {
        gross_salary: gross,
        ctc: Number(s.ctc) || gross * 12,
        basic: Number(s.basic) || gross,
        hra: Number(s.hra) || 0,
        special_allowance: Number(s.special_allowance) || 0,
        conveyance_allowance: Number(s.conveyance_allowance) || 0,
        net_salary: Number(s.net_salary) || gross,
        professional_tax: Number(s.professional_tax) || 0,
        pf_applicable: !!s.pf_applicable,
        esi_applicable: !!s.esi_applicable,
        tds_applicable: false,
      },
      status: "active",
      activated_at: new Date(),
    });

    const migrated = await migrateMachineAttendance(emp, essl);
    res.json({ success: true, data: emp, migrated_days: migrated });
  } catch (err) {
    if (emp) {
      await Employee.findByIdAndDelete(emp._id).catch(() => { });
      await EmploymentDetails.deleteOne({ employee_id: emp._id }).catch(() => { });
    }
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST: re-run attendance migration for one staff ──────────
router.post("/:id/migrate", auth, hrOnly, async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp || !emp.essl_id)
      return res.status(400).json({ success: false, message: "Employee / eSSL ID not found" });
    const n = await migrateMachineAttendance(emp, norm(emp.essl_id));
    res.json({ success: true, migrated_days: n });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST: file doc upload (status touch pannaadhu) ───────────
router.post("/:id/docs", auth, hrOnly, (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ success: false, message: err.message });
    try {
      const { docType } = req.body;
      if (!req.file || !docType)
        return res.status(400).json({ success: false, message: "file & docType required" });
      const doc = await Document.findOneAndUpdate(
        { employeeId: req.params.id, docType },
        { fileUrl: req.file.path, publicId: req.file.filename },
        { upsert: true, new: true }
      );
      res.json({ success: true, document: doc });
    } catch (e) {
      res.status(500).json({ success: false, message: e.message });
    }
  });
});

// ── POST: text doc (Reference Number 1 / 2) ──────────────────
router.post("/:id/docs/text", auth, hrOnly, async (req, res) => {
  try {
    const { docType, value } = req.body;
    if (!docType || !String(value || "").trim())
      return res.status(400).json({ success: false, message: "docType & value required" });
    const doc = await Document.findOneAndUpdate(
      { employeeId: req.params.id, docType },
      { fileUrl: String(value).trim() },
      { upsert: true, new: true }
    );
    res.json({ success: true, document: doc });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
});

module.exports = router;