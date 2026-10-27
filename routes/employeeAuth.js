const express = require('express');
const router = express.Router();
const Employee = require('../models/Employee');
const Document = require('../models/Document');
const Notification = require('../models/Notification');
const { createNotification } = require('../helpers/notificationHelper');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const Counter = require('../models/Counter');
const axios = require('axios');
const auth = require('../middleware/auth');
const KpiAssignment = require('../models/KpiAssignment');
const hrOnly = require("../middleware/hrOnly");


const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const { Resend } = require('resend');
const crypto = require('crypto');

// ─── eSSL Server URL ─────────────────────────────────────────
const ESSL_SERVER = process.env.ESSL_SERVER_URL || 'http://localhost:5000';

// ─── eSSL Bridge Helper ───────────────────────────────────────
async function callEsslBridge(endpoint, data) {
  try {
    const resp = await axios.post(
      `${ESSL_SERVER}/essl-bridge/${endpoint}`,
      data,
      { timeout: 6000 }
    );
    return resp.data;
  } catch (err) {
    console.warn(`⚠️  eSSL bridge (${endpoint}) failed:`, err.message);
    return { ok: false, error: err.message };
  }
}

// ================= CLOUDINARY STORAGE =================
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: 'documents',
      resource_type: 'auto',
      public_id: Date.now() + '-' + file.originalname,
    };
  },
});

// ================= MULTER =================
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/jpg',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type: ' + file.mimetype), false);
    }
  },
});

// ================= AUTO EMPLOYEE ID GENERATOR =================
const generateEmployeeId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: 'employeeId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return 'EMP-' + String(counter.seq).padStart(3, '0');
};

// ================= REGISTER =================
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, mobile, department, designation } = req.body;

    if (!name || !email || !password || !mobile || !department || !designation) {
      return res.status(400).json({ message: 'ALL_FIELDS_REQUIRED' });
    }

    const existingEmail = await Employee.findOne({ email });
    if (existingEmail) {
      return res.status(400).json({ message: 'EMAIL_ALREADY_REGISTERED' });
    }

    const existingMobile = await Employee.findOne({ mobile });
    if (existingMobile) {
      return res.status(400).json({ message: 'MOBILE_ALREADY_REGISTERED' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const employee = new Employee({
      employeeId: await generateEmployeeId(),
      name,
      email,
      password: hashedPassword,
      mobile,
      department,
      designation,
      documentsCompleted: false,
      status: 'pending',
    });

    await employee.save();

    // ✅ NEW — HR notification on new employee registration
    try {
      await createNotification({
        recipient_id: "hr_admin_001",
        recipient_role: "hr",
        type: "employee",
        title: "New Employee Registered",
        message: `${name} registered and is waiting for approval`,
        link: "/hr/dashboard/hr-pending",
      });
    } catch (notifErr) {
      console.error("Register notification error:", notifErr.message);
    }

    res.status(201).json({
      message: 'REGISTER_SUCCESS',
      employeeId: employee.employeeId,
    });
  } catch (err) {
    console.log('REGISTER ERROR:', err);
    res.status(500).json({ message: err.message });
  }
});

// ================= LOGIN =================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Employee.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email' });

    if (user.staffType === 'machine_staff') {
      return res.status(403).json({ message: 'NO_LOGIN_ACCESS' });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid password' });

    // ✅ INGA MATUM ADD PANNU — இந்த 2 check
    if (user.accessDeactivated) {
      return res.status(403).json({ message: 'ACCESS_DEACTIVATED' });
    }
    if (user.exitType === 'relieved' || user.exitType === 'fired') {
      return res.status(403).json({ message: 'ACCOUNT_INACTIVE' });
    }

    // const token = jwt.sign({ id: user._id }, 'SECRETKEY', { expiresIn: '7d' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: '7d' });

    res.json({
      token,
      documentsCompleted: !!user.documentsCompleted,
      id: user._id,
      employeeId: user.employeeId,
    });
  } catch {
    res.status(500).json({ message: 'Server error' });
  }
});


// ================= UPLOAD DOCUMENT =================
router.post('/upload-doc', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const { employeeId, docType } = req.body;

      if (!employeeId) return res.status(400).json({ message: 'EMPLOYEE_ID_MISSING' });
      if (!req.file) return res.status(400).json({ message: 'NO_FILE_UPLOADED' });

      // ✅ FIX: insert இல்லை, upsert — already இருந்தா update பண்ணு
      const savedDoc = await Document.findOneAndUpdate(
        { employeeId, docType },
        { fileUrl: req.file.path, updatedAt: new Date() },
        { upsert: true, new: true }
      );

      const requiredDocs = [
        'Aadhaar', 'PAN', 'Passport Photo',
        '10th Marksheet', '12th Marksheet',
        'Resume', 'Bank Passbook',
        'Ration Card Front', 'Ration Card Back',
      ];

      const uploadedDocs = await Document.find({ employeeId });
      const uploadedTypes = uploadedDocs.map(d => d.docType);
      const allUploaded = requiredDocs.every(doc => uploadedTypes.includes(doc));



      const isHrUpload = req.body.isHrUpload === "true";
      const emp0 = await Employee.findById(employeeId).select('staffType').lean();
      const keepStatus = isHrUpload || emp0?.staffType === 'machine_staff';

      await Employee.findByIdAndUpdate(employeeId, {
        ...(keepStatus ? {} : { status: 'pending' }),
        documentsCompleted: allUploaded ? true : undefined,
      })

      res.json({ message: 'Uploaded successfully', fileUrl: req.file.path, document: savedDoc });
    } catch {
      res.status(500).json({ message: 'Upload failed' });
    }
  });
});


// ================= DELETE DOCUMENT =================
// NOTE: this route was missing entirely, which is why the delete button
// on HR-issued documents (Offer Letter, Appointment Letter, NDA, etc.)
// and employee-uploaded documents silently did nothing — the frontend's
// DELETE request to /api/employee/delete-doc had no matching route and
// was failing with a 404 that only showed up in the console.
router.delete('/delete-doc', async (req, res) => {
  try {
    const { employeeId, docType } = req.body;

    if (!employeeId) return res.status(400).json({ message: 'EMPLOYEE_ID_MISSING' });
    if (!docType) return res.status(400).json({ message: 'DOC_TYPE_MISSING' });

    const doc = await Document.findOne({ employeeId, docType });
    if (!doc) return res.status(404).json({ message: 'DOCUMENT_NOT_FOUND' });

    // Best-effort cleanup of the Cloudinary asset — a failure here should
    // not block removing the database record.
    if (doc.publicId) {
      try {
        await cloudinary.uploader.destroy(doc.publicId, { resource_type: 'auto' });
      } catch (cloudErr) {
        console.error('Cloudinary destroy failed (continuing with DB delete):', cloudErr.message);
      }
    }

    await Document.deleteOne({ _id: doc._id });

    // Keep documentsCompleted status accurate after removal.
    const requiredDocs = [
      'Aadhaar', 'PAN', 'Passport Photo',
      '10th Marksheet', '12th Marksheet',
      'Resume', 'Bank Passbook',
      'Ration Card Front', 'Ration Card Back',
    ];
    const remainingDocs = await Document.find({ employeeId });
    const remainingTypes = remainingDocs.map(d => d.docType);
    const allUploaded = requiredDocs.every(rd => remainingTypes.includes(rd));
    await Employee.findByIdAndUpdate(employeeId, { documentsCompleted: allUploaded });

    res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    console.error('Delete-doc error:', err);
    res.status(500).json({ message: 'Delete failed' });
  }
});

router.delete('/document/:docId', async (req, res) => {
  try {
    const doc = await Document.findById(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'DOCUMENT_NOT_FOUND' });
    await Document.deleteOne({ _id: doc._id });
    res.json({ message: 'Document deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Delete failed' });
  }
});

// ================= REPLACE DOCUMENT =================
router.post('/replace-doc', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const { docId } = req.body;
      const doc = await Document.findById(docId);
      if (!doc) return res.status(404).json({ message: 'Document not found' });

      const updated = await Document.findByIdAndUpdate(
        docId,
        { fileUrl: req.file.path },
        { new: true }
      );

      const emp = await Employee.findByIdAndUpdate(doc.employeeId, {
        status: 'pending',
        remarks: '',
        reuploaded: true,
      }, { new: true });

      // ✅ NEW — HR notification on document reupload
      try {
        await Notification.create({
          recipient_id: "hr_admin_001",
          recipient_role: "hr",
          type: "document",
          title: "Document Reuploaded",
          message: `${emp.name} reuploaded "${doc.docType}"`,
          link: "",
          isRead: false,
        });
      } catch (notifErr) {
        console.error("Reupload notification error:", notifErr.message);
      }

      res.json(updated);
    } catch {
      res.status(500).json({ message: 'Replace failed' });
    }
  });
});

// ================= PROFILE IMAGE =================
router.post('/upload-profile', (req, res) => {
  upload.single('file')(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const { employeeId } = req.body;
      const user = await Employee.findByIdAndUpdate(
        employeeId,
        { profileImage: req.file.path },
        { new: true }
      );
      res.json({ message: 'Profile uploaded', user });
    } catch {
      res.status(500).json({ message: 'Upload failed' });
    }
  });
});

// ================= COMPLETE DOCUMENTS =================
router.put('/complete-documents', async (req, res) => {
  try {
    const { employeeId } = req.body;

    const requiredDocs = [
      'Aadhaar', 'PAN', 'Passport Photo',
      '10th Marksheet', '12th Marksheet',
      'Resume', 'Bank Passbook',
    ];

    const uploaded = await Document.find({ employeeId });
    const types = uploaded.map(d => d.docType);
    const ok = requiredDocs.every(doc => types.includes(doc));

    if (!ok) return res.status(400).json({ message: 'UPLOAD_ALL_REQUIRED_DOCS_FIRST' });

    // ✅ Identity Proof — Ration Card (both sides) OR Gas Book must be present
    const hasRation = types.includes('Ration Card Front') && types.includes('Ration Card Back');
    const hasGasBook = types.includes('Gas Book');
    if (!hasRation && !hasGasBook) {
      return res.status(400).json({ message: 'IDENTITY_PROOF_REQUIRED' });
    }

    // ✅ Reference Numbers 1 & 2 — always mandatory, regardless of identity proof choice
    const refDoc1 = uploaded.find(d => d.docType === 'Reference Number 1');
    const refDoc2 = uploaded.find(d => d.docType === 'Reference Number 2');
    const hasRefNumbers =
      refDoc1 && refDoc1.fileUrl && refDoc1.fileUrl.trim() !== '' &&
      refDoc2 && refDoc2.fileUrl && refDoc2.fileUrl.trim() !== '';
    if (!hasRefNumbers) {
      return res.status(400).json({ message: 'REFERENCE_NUMBERS_REQUIRED' });
    }

    const emp = await Employee.findByIdAndUpdate(employeeId, { documentsCompleted: true }, { new: true });

    // ✅ NEW — HR notification on document submission
    try {
      await Notification.create({
        recipient_id: "hr_admin_001",
        recipient_role: "hr",
        type: "document",
        title: "Documents Submitted",
        message: `${emp.name} submitted all documents`,
        link: "",
        isRead: false,
      });
    } catch (notifErr) {
      console.error("Submit notification error:", notifErr.message);
    }

    res.json({ message: 'Documents completed' });
  } catch {
    res.status(500).json({ message: 'Error updating' });
  }
});

// ================= GET USER =================
router.get('/me/:id', async (req, res) => {
  try {
    const user = await Employee.findById(req.params.id);
    const documents = await Document.find({ employeeId: req.params.id });

    res.json({
      id: user._id,
      employeeId: user.employeeId,   // ✅ NEW LINE — indha field thaan missing
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      altMobile: user.altMobile,
      dob: user.dob,
      address: user.address,
      department: user.department,
      designation: user.designation,
      essl_id: user.essl_id,
      status: user.status,
      remarks: user.remarks,
      documentsCompleted: !!user.documentsCompleted,
      profileImage: user.profileImage,
      shift: user.shift,
      canManageProducts: user.canManageProducts,
      canManageLoanProcess: user.canManageLoanProcess,
      isLoanProcessHead: user.isLoanProcessHead,
      loanProcessReportAccess: user.loanProcessReportAccess,
      canApproveLoanIncentive: user.canApproveLoanIncentive,
      canManageLoanFollowup: user.canManageLoanFollowup,
      documents,
    });
  } catch {
    res.status(500).json({ message: 'Error fetching user' });
  }
});

// ================= UPDATE PROFILE =================
router.put('/update-profile', async (req, res) => {
  try {
    const { employeeId, name, email, mobile, altMobile, dob, address, department, designation } = req.body;

    const updatedEmployee = await Employee.findByIdAndUpdate(
      employeeId,
      { name, email, mobile, altMobile, dob, address, department, designation },
      { new: true }
    );

    res.json(updatedEmployee);
  } catch (err) {
    console.log('❌ ERROR:', err);
    res.status(500).json({ message: 'Profile update failed' });
  }
});


// ================= GET ALL EMPLOYEES =================
router.get('/employees', auth, hrOnly, async (req, res) => {
  try {
    const { status, email } = req.query;

    // ✅ Email filter — HR Approved essl_id lookup
    if (email) {
      const emp = await Employee.findOne({ email });
      return res.json({
        data: emp ? [emp] : [],
        total: emp ? 1 : 0
      });
    }

    let filter = {};
    if (status) {
      const statuses = status.split(',').map(s => s.trim());
      filter = { status: { $in: statuses } };
    }
    const employees = await Employee.find(filter).select(
      "name email department designation employeeId empId essl_id status mobile profileImage exitType accessDeactivated"
    );
    res.json({ success: true, total: employees.length, data: employees });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================= DEPARTMENT DISTRIBUTION =================
router.get('/employees/department-distribution', auth, hrOnly, async (req, res) => {
  try {
    const dist = await Employee.aggregate([
      { $group: { _id: '$department', count: { $sum: 1 } } },
      { $project: { department: '$_id', count: 1, _id: 0 } },
    ]);
    res.json({ data: dist });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================= EXIT FORM VALIDATION (shared by relieve + fire) =================
const EXIT_CATEGORIES = ['resigned', 'terminated', 'contract_end', 'retired', 'other'];

function parseExitBody(body = {}) {
  const { relievingDate, exitCategory, exitReason, noticePeriodServed, rehireEligible } = body;

  if (!relievingDate || isNaN(new Date(relievingDate))) {
    return { error: 'Relieving date is required' };
  }
  if (!EXIT_CATEGORIES.includes(exitCategory)) {
    return { error: 'Exit type is required' };
  }

  return {
    fields: {
      relievingDate: new Date(relievingDate),
      exitCategory,
      exitReason: (exitReason || '').trim(),
      noticePeriodServed: typeof noticePeriodServed === 'boolean' ? noticePeriodServed : null,
      rehireEligible: typeof rehireEligible === 'boolean' ? rehireEligible : null,
      relievedAt: new Date(),
    },
  };
}

// ================= RELIEVE EMPLOYEE =================
router.patch('/employees/:id/relieve', auth, hrOnly, async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const parsed = parseExitBody(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    await Employee.findByIdAndUpdate(req.params.id, {
      exitType: 'relieved',
      accessDeactivated: false,
      status: 'relieved',
      ...parsed.fields,
    });

    await KpiAssignment.updateMany(
      { employee_id: req.params.id, status: 'active' },
      { $set: { status: 'cancelled', notes: 'Auto-cancelled: employee relieved' } }
    );

    res.json({ message: 'Employee marked as relieved' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to update' });
  }
});

// ================= FIRE EMPLOYEE =================
router.patch('/employees/:id/fire', auth, hrOnly, async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const parsed = parseExitBody(req.body);
    if (parsed.error) return res.status(400).json({ message: parsed.error });

    await Employee.findByIdAndUpdate(req.params.id, {
      exitType: 'fired',
      accessDeactivated: false,
      status: 'fired',
      ...parsed.fields,
    });

    await KpiAssignment.updateMany(
      { employee_id: req.params.id, status: 'active' },
      { $set: { status: 'cancelled', notes: 'Auto-cancelled: employee fired' } }
    );

    res.json({ message: 'Employee marked as fired' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to update' });
  }
});

// ================= DEACTIVATE ACCESS =================
router.patch('/employees/:id/deactivate-access', auth, hrOnly, async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    await Employee.findByIdAndUpdate(req.params.id, {
      accessDeactivated: true,
    });

    res.json({ message: 'Access deactivated successfully' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to deactivate access' });
  }
});

// ================= EDIT EXIT DETAILS =================
router.patch('/employees/:id/exit-details', auth, hrOnly, async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    if (!emp.exitType) return res.status(400).json({ message: 'Employee is not relieved/fired' });

    const { relievingDate, exitCategory, exitReason, noticePeriodServed, rehireEligible } = req.body || {};

    emp.relievingDate = relievingDate ? new Date(relievingDate) : null;
    emp.exitCategory = exitCategory || null;
    emp.exitReason = (exitReason || '').trim();
    emp.noticePeriodServed = typeof noticePeriodServed === 'boolean' ? noticePeriodServed : null;
    emp.rehireEligible = typeof rehireEligible === 'boolean' ? rehireEligible : null;
    await emp.save();

    res.json({ message: 'Exit details saved', data: emp });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to save exit details' });
  }
});

// ================= WORK SUMMARY (relieved employee drawer) =================
router.get('/employees/:id/work-summary', auth, hrOnly, async (req, res) => {
  try {
    const Attendance = require('../models/Attendance');
    const MachineAttendance = require('../models/MachineAttendance');
    const PerformanceReview = require('../models/PerformanceReview');
    const IncentiveResult = require('../models/IncentiveResult');
    const { EmployeeTraining } = require('../models/TrainingRca');

    const emp = await Employee.findById(req.params.id)
      .select('staffType essl_id relievingDate');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    // Relieving date irundha adhu varaikkum mattum count pannum
    const upTo = emp.relievingDate
      ? emp.relievingDate.toISOString().slice(0, 10)
      : null;

    // ── Attendance ──
    let match, Model;
    if (emp.staffType === 'machine_staff' && emp.essl_id) {
      Model = MachineAttendance;
      match = { essl_id: emp.essl_id };
    } else {
      Model = Attendance;
      match = { employee_id: emp._id };
    }
    if (upTo) match.date = { $lte: upTo };

    const rows = await Model.aggregate([
      { $match: match },
      { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const attendance = { present: 0, late: 0, half_day: 0, leave: 0, absent: 0 };
    rows.forEach((r) => { if (r._id in attendance) attendance[r._id] = r.n; });

    // ── Performance (finalized reviews) ──
    const reviews = await PerformanceReview
      .find({ employee_id: emp._id, status: 'finalized' })
      .sort({ createdAt: -1 })
      .select('period final_score rating');
    const scored = reviews.filter((r) => typeof r.final_score === 'number');
    const performance = {
      reviewCount: reviews.length,
      last: reviews[0]
        ? { period: reviews[0].period, score: reviews[0].final_score ?? null, rating: reviews[0].rating || '' }
        : null,
      avgScore: scored.length
        ? Math.round((scored.reduce((s, r) => s + r.final_score, 0) / scored.length) * 10) / 10
        : null,
    };

    // ── Training ──
    const trainings = await EmployeeTraining.find({ employeeId: emp._id }).select('status');
    const tCompleted = trainings.filter((t) => t.status === 'completed').length;
    const tOverdue = trainings.filter((t) => t.status === 'overdue').length;
    const tWaived = trainings.filter((t) => t.status === 'waived').length;
    const training = {
      total: trainings.length,
      completed: tCompleted,
      overdue: tOverdue,
      pending: trainings.length - tCompleted - tOverdue - tWaived,
    };

    // ── Incentives paid ──
    const paid = await IncentiveResult
      .find({ employee_id: emp._id, status: 'paid' })
      .select('calculated_amount completion_bonus');
    const incentives = {
      count: paid.length,
      totalPaid: paid.reduce((s, r) => s + (r.calculated_amount || 0) + (r.completion_bonus || 0), 0),
    };

    res.json({ data: { attendance, performance, training, incentives } });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to load work summary' });
  }
});

// ================= MONTH-WISE ATTENDANCE (relieved employee drawer) =================
router.get('/employees/:id/attendance-monthly', auth, hrOnly, async (req, res) => {
  try {
    const Attendance = require('../models/Attendance');
    const MachineAttendance = require('../models/MachineAttendance');
    const Payslip = require('../models/Payslip');
    const { computeAttendanceSummary } = require('../helpers/payrollCalculator');

    const emp = await Employee.findById(req.params.id).select('staffType essl_id relievingDate');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const pad = (n) => String(n).padStart(2, '0');
    const isMachine = emp.staffType === 'machine_staff' && !!emp.essl_id;
    const Model = isMachine ? MachineAttendance : Attendance;
    const key = isMachine ? { essl_id: emp.essl_id } : { employee_id: emp._id };

    const first = await Model.findOne(key).sort({ date: 1 }).select('date').lean();
    if (!first) return res.json({ data: { machineStaff: isMachine, months: [] } });
    const last = await Model.findOne(key).sort({ date: -1 }).select('date').lean();

    // Last actual working day (Present / Late / Half Day)
    const lastWorked = await Model.findOne({
      ...key,
      status: { $in: ['present', 'late', 'half_day'] },
    }).sort({ date: -1 }).select('date').lean();

    // Counting range: first attendance record → relieving date,
    // or the last actual working day when relieving date is not set
    const startDate = first.date;
    const fallbackEnd = lastWorked ? lastWorked.date : last.date;
    let endDate = emp.relievingDate
      ? emp.relievingDate.toISOString().slice(0, 10)
      : fallbackEnd;
    if (endDate < startDate) endDate = fallbackEnd;

    // month list
    const monthList = [];
    let y = +startDate.slice(0, 4), m = +startDate.slice(5, 7);
    const endY = +endDate.slice(0, 4), endM = +endDate.slice(5, 7);
    while (y < endY || (y === endY && m <= endM)) {
      monthList.push({ y, m });
      m += 1;
      if (m > 12) { m = 1; y += 1; }
    }

    let months;

    if (isMachine) {
      // Machine staff: payroll logic apply aagaadhu, simple counts mattum
      const rows = await MachineAttendance.aggregate([
        { $match: key },
        { $group: { _id: { month: { $substr: ['$date', 0, 7] }, status: '$status' }, n: { $sum: 1 } } },
      ]);
      const map = {};
      rows.forEach((r) => {
        const mo = r._id.month;
        map[mo] = map[mo] || { present: 0, late: 0, halfDay: 0, leave: 0, absent: 0 };
        const st = r._id.status;
        if (st === 'present') map[mo].present += r.n;
        else if (st === 'late') { map[mo].present += r.n; map[mo].late += r.n; }
        else if (st === 'half_day') map[mo].halfDay += r.n;
        else if (st === 'leave') map[mo].leave += r.n;
        else if (st === 'absent') map[mo].absent += r.n;
      });
      months = monthList.map(({ y, m }) => {
        const ym = `${y}-${pad(m)}`;
        const c = map[ym] || { present: 0, late: 0, halfDay: 0, leave: 0, absent: 0 };
        return { month: ym, totalDays: null, ...c, holiday: 0, weekend: 0, lop: null, payable: null, payslip: null };
      });
    } else {
      const lateRows = await Attendance.aggregate([
        { $match: { employee_id: emp._id, status: 'late' } },
        { $group: { _id: { $substr: ['$date', 0, 7] }, n: { $sum: 1 } } },
      ]);
      const lateMap = {};
      lateRows.forEach((r) => { lateMap[r._id] = r.n; });

      const slips = await Payslip.find({ employee_id: emp._id })
        .select('month year status net_pay').lean();
      const slipMap = {};
      slips.forEach((p) => { slipMap[`${p.year}-${pad(p.month)}`] = p; });

      months = await Promise.all(monthList.map(async ({ y, m }) => {
        const ym = `${y}-${pad(m)}`;
        const from = ym === startDate.slice(0, 7) ? startDate : null;
        const upto = ym === endDate.slice(0, 7) ? endDate : null;
        const s = await computeAttendanceSummary(emp._id, m, y, { from, upto });
        const slip = slipMap[ym];
        return {
          month: ym,
          totalDays: s.total_days_in_month,
          countedFrom: from,
          countedUpto: upto,
          present: s.present_days,          // late-um ulla irukku (payroll rule)
          late: lateMap[ym] || 0,
          halfDay: s.half_days,
          leave: s.paid_leave_days + s.unpaid_leave_days,
          absent: s.absent_days,
          holiday: s.holiday_days,
          weekend: s.weekend_days,
          lop: s.lop_days,
          payable: s.payable_days,
          overtimeMin: s.overtime_minutes,
          payslip: slip ? { status: slip.status, netPay: slip.net_pay } : null,
        };
      }));
    }

    res.json({ data: { machineStaff: isMachine, startDate, endDate, months } });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to load monthly attendance' });
  }
});


// ================= EXIT CLEARANCE: LOAD =================
router.get('/employees/:id/clearance', auth, hrOnly, async (req, res) => {
  try {
    const Advance = require('../models/Advance');
    const IncentiveResult = require('../models/IncentiveResult');

    const emp = await Employee.findById(req.params.id).select('clearance');
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const [approvedAdv, awaitingAdv, approvedInc, awaitingInc] = await Promise.all([
      Advance.find({ employee_id: emp._id, status: 'approved' })
        .select('amount reason recovery_month recovery_year').lean(),
      Advance.countDocuments({ employee_id: emp._id, status: 'pending' }),
      IncentiveResult.find({ employee_id: emp._id, status: 'approved' })
        .select('calculated_amount completion_bonus').lean(),
      IncentiveResult.countDocuments({ employee_id: emp._id, status: 'pending' }),
    ]);

    const DEFAULT_ASSETS = ['Laptop', 'ID Card', 'SIM Card', 'Other Assets'];
    const c = emp.clearance || {};
    const assets = c.assets && c.assets.length
      ? c.assets.map((a) => ({ name: a.name, status: a.status || '', remarks: a.remarks || '' }))
      : DEFAULT_ASSETS.map((name) => ({ name, status: '', remarks: '' }));

    res.json({
      data: {
        advances: {
          count: approvedAdv.length,
          totalAmount: approvedAdv.reduce((s, a) => s + (a.amount || 0), 0),
          items: approvedAdv.map((a) => ({
            amount: a.amount,
            reason: a.reason,
            recoveryMonth: a.recovery_month || null,
            recoveryYear: a.recovery_year || null,
          })),
          awaitingApproval: awaitingAdv,
        },
        incentives: {
          approvedUnpaidCount: approvedInc.length,
          approvedUnpaidAmount: approvedInc.reduce(
            (s, r) => s + (r.calculated_amount || 0) + (r.completion_bonus || 0), 0
          ),
          awaitingApproval: awaitingInc,
        },
        assets,
        settlement: {
          status: c.settlementStatus || '',
          amount: c.settlementAmount ?? '',
          date: c.settlementDate ? c.settlementDate.toISOString().slice(0, 10) : '',
          remarks: c.settlementRemarks || '',
        },
      },
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to load clearance' });
  }
});

// ================= EXIT CLEARANCE: SAVE =================
router.patch('/employees/:id/clearance', auth, hrOnly, async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });
    if (!emp.exitType) return res.status(400).json({ message: 'Employee is not relieved/fired' });

    const { assets, settlement } = req.body || {};
    const assetStatuses = ['returned', 'pending', 'na'];
    const settlementStatuses = ['pending', 'processed', 'paid'];

    const cleanAssets = Array.isArray(assets)
      ? assets
        .filter((a) => a && String(a.name || '').trim())
        .slice(0, 20)
        .map((a) => ({
          name: String(a.name).trim().slice(0, 60),
          status: assetStatuses.includes(a.status) ? a.status : null,
          remarks: String(a.remarks || '').trim().slice(0, 200),
        }))
      : [];

    const s = settlement || {};
    const amount = s.amount === '' || s.amount == null ? null : Number(s.amount);
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return res.status(400).json({ message: 'Invalid settlement amount' });
    }

    emp.clearance = {
      assets: cleanAssets,
      settlementStatus: settlementStatuses.includes(s.status) ? s.status : null,
      settlementAmount: amount,
      settlementDate: s.date ? new Date(s.date) : null,
      settlementRemarks: String(s.remarks || '').trim().slice(0, 300),
      updatedAt: new Date(),
    };
    await emp.save();

    res.json({ message: 'Clearance saved' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to save clearance' });
  }
});

// ================= EMPLOYEE DOCUMENTS (exit + joining/HR) =================

router.get('/employees/:id/documents', auth, hrOnly, async (req, res) => {
  try {
       const docs = await Document.find({ employeeId: req.params.id })
      .select('docType fileUrl uploadedByName updatedAt').lean();

    res.json({ data: docs });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to load documents' });
  }
});

// ================= REACTIVATE EMPLOYEE =================
router.patch('/employees/:id/reactivate', auth, hrOnly, async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    await Employee.findByIdAndUpdate(req.params.id, {
      exitType: null,
      accessDeactivated: false,
      status: 'active',
      relievingDate: null, exitCategory: null, exitReason: "",
      noticePeriodServed: null, rehireEligible: null, relievedAt: null,
      clearance: {
        assets: [], settlementStatus: null, settlementAmount: null,
        settlementDate: null, settlementRemarks: "", updatedAt: null
      },
    });

    res.json({ message: 'Employee reactivated successfully' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to reactivate' });
  }
});


// ================= DELETE EMPLOYEE =================
router.delete('/employees/:id', auth, hrOnly, async (req, res) => {
  try {
    const employeeId = req.params.id;

    const emp = await Employee.findById(employeeId);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const esslId = emp.essl_id;

    await Employee.findByIdAndDelete(employeeId);
    await Document.deleteMany({ employeeId });

    let esslResult = { ok: false, error: 'No eSSL ID' };
    if (esslId) {
      esslResult = await callEsslBridge('employee/delete', { essl_id: esslId });
      console.log(`🗑️  eSSL sync → Delete ${emp.name} (${esslId}) → ${esslResult.ok ? '✅' : '❌'}`);
    }

    res.json({
      message: 'Employee deleted successfully',
      essl_sync: {
        attempted: !!esslId,
        success: esslResult.ok,
        message: esslResult.ok ? 'Removed from machine' : (esslResult.error || ''),
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Delete failed' });
  }
});

// ================= GET EMPLOYEE BY EMPLOYEE ID =================
router.get('/employees/:id', auth, hrOnly, async (req, res) => {
  try {
    const employee = await Employee.findOne({ employeeId: req.params.id });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    res.json({ data: employee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ================= SAVE SOCIAL LINK =================
router.post('/save-link', async (req, res) => {
  try {
    const { employeeId, docType, url } = req.body;

    if (!employeeId) return res.status(400).json({ message: 'EMPLOYEE_ID_MISSING' });
    if (!url) return res.status(400).json({ message: 'URL_MISSING' });

    await Document.findOneAndUpdate(
      { employeeId, docType },
      { fileUrl: url },
      { upsert: true, new: true }
    );

    const e0 = await Employee.findById(employeeId).select('staffType').lean();
    if (e0?.staffType !== 'machine_staff') {
      await Employee.findByIdAndUpdate(employeeId, { status: 'pending' });
    }

    res.json({ message: 'Link saved successfully' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to save link' });
  }
});

// ================= FORGOT PASSWORD =================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await Employee.findOne({ email });
    if (!user) return res.status(404).json({ message: 'EMAIL_NOT_FOUND' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 15 * 60 * 1000;

    await Employee.findByIdAndUpdate(user._id, {
      resetPasswordToken: token,
      resetPasswordExpiry: expiry,
    });

    const resetLink = `${process.env.FRONTEND_URL}/employee/reset-password/${token}`;
    const resend = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from: 'HR Portal <noreply@service.radnus.in>',
      to: user.email,
      subject: 'Reset Your Password — HR Portal',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px;border:1px solid #e5e7eb;border-radius:12px">
          <h2 style="color:#1e40af">Password Reset Request</h2>
          <p>Hi <strong>${user.name}</strong>,</p>
          <p>Click the button below to reset your password. This link is valid for <strong>15 minutes</strong>.</p>
          <a href="${resetLink}"
             style="display:inline-block;margin:16px 0;padding:12px 28px;background:#1e40af;color:#fff;border-radius:8px;text-decoration:none;font-weight:600">
            Reset Password
          </a>
          <p style="color:#6b7280;font-size:13px">If you didn't request this, ignore this email.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb">
          <p style="color:#9ca3af;font-size:12px">HR Portal &bull; Link expires in 15 minutes</p>
        </div>
      `,
    });

    res.json({ message: 'RESET_LINK_SENT' });
  } catch (err) {
    console.log('FORGOT PASSWORD ERROR:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ================= RESET PASSWORD =================
router.post('/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await Employee.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: 'TOKEN_INVALID_OR_EXPIRED' });

    const hashed = await bcrypt.hash(newPassword, 10);

    await Employee.findByIdAndUpdate(user._id, {
      password: hashed,
      resetPasswordToken: undefined,
      resetPasswordExpiry: undefined,
    });

    res.json({ message: 'PASSWORD_RESET_SUCCESS' });
  } catch (err) {
    console.log('RESET PASSWORD ERROR:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

// ================= SECURE DOCUMENT VIEW =================
router.get('/view-doc/:docId', auth , async (req, res) => {
  try {
    const doc = await Document.findById(req.params.docId);
    if (!doc) return res.status(404).json({ message: 'Document not found' });

    const fileUrl = doc.fileUrl;

    // ✅ OLD public uploads — direct URL return
    if (!fileUrl.includes('/private/')) {
      return res.json({ url: fileUrl });
    }

    // ✅ NEW private uploads — signed URL generate
    const urlObj = new URL(fileUrl);
    const parts = urlObj.pathname.split('/').filter(Boolean);
    // parts = ['dp9jv4wyh', 'image', 'private', 'v1234567', 'documents', 'filename.jpg']

    // ✅ FIX: 'private' பிறகு version skip பண்ணி public_id எடு
    const privateIdx = parts.findIndex(p => p === 'private');
    const afterPrivate = parts.slice(privateIdx + 1); // ['v1234567', 'documents', 'filename.jpg']

    // version number (v로 start ஆனது) skip பண்ணு
    const withoutVersion = afterPrivate[0].startsWith('v') && /^v\d+$/.test(afterPrivate[0])
      ? afterPrivate.slice(1)
      : afterPrivate;
    // ['documents', 'filename.jpg']

    const fullPath = withoutVersion.join('/');           // 'documents/1779530783706-bench-press.jpg'
    const ext = fullPath.split('.').pop();           // 'jpg'
    const publicId = fullPath.replace(/\.[^/.]+$/, '');  // 'documents/1779530783706-bench-press'

    const resourceType = fileUrl.includes('/image/') ? 'image'
      : fileUrl.includes('/video/') ? 'video'
        : 'raw';

    const signedUrl = cloudinary.utils.private_download_url(
      publicId, ext,
      {
        resource_type: resourceType,
        expires_at: Math.floor(Date.now() / 1000) + 300,
        attachment: false,
      }
    );

    return res.json({ url: signedUrl });

  } catch (err) {
    console.log('VIEW DOC ERROR:', err);
    res.status(500).json({ message: 'Failed to generate secure URL' });
  }
});



// ================= MIGRATE SHIFTS (run once) =================
router.post('/employees/migrate-shifts', auth, hrOnly, async (req, res) => {
  try {
    const result = await Employee.updateMany(
      { shift: { $exists: false } },
      { $set: { shift: "General" } }
    );
    res.json({ success: true, updated: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ================= ASSIGN SHIFT TO EMPLOYEE =================
router.put('/employees/:id/shift', auth, hrOnly, async (req, res) => {
  try {
    const { start, end } = req.body;
    if (!start || !end) return res.status(400).json({ message: 'start and end required' });

    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    // ✅ KEY FIX: shift string-a irundha, direct MongoDB update with $set whole object
    await Employee.collection.updateOne(
      { _id: emp._id },
      { $set: { shift: { start, end } } }  // ← whole object replace, not dot notation
    );

    const updated = await Employee.findById(req.params.id).select("name employeeId shift");
    res.json({ success: true, message: 'Shift updated', data: updated });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});


router.put('/:id/product-access', auth, async (req, res) => {
  try {
    if (req.user.role !== 'hr') {
      return res.status(403).json({ success: false, message: 'Only HR can assign access' });
    }

    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    // Single-assignee rule — turn OFF for everyone else first
    await Employee.updateMany({ _id: { $ne: emp._id } }, { $set: { canManageProducts: false } });

    emp.canManageProducts = true;
    await emp.save();

    res.json({ success: true, message: `Product access assigned to ${emp.name}`, data: emp });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= REMOVE PRODUCT ACCESS (HR only) =================
router.delete('/:id/product-access', auth, async (req, res) => {
  try {
    if (req.user.role !== 'hr') {
      return res.status(403).json({ success: false, message: 'Only HR can remove access' });
    }
    const emp = await Employee.findByIdAndUpdate(req.params.id, { canManageProducts: false }, { new: true });
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });
    res.json({ success: true, message: `Access removed from ${emp.name}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ================= GET CURRENT ASSIGNED EMPLOYEE (HR view) =================
router.get('/product-access/current', auth, async (req, res) => {
  try {
    if (req.user.role !== 'hr') {
      return res.status(403).json({ success: false, message: 'Only HR can view this' });
    }
    const emp = await Employee.findOne({ canManageProducts: true }).select('name employeeId email department');
    res.json({ success: true, data: emp || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/change-password", async (req, res) => {
  try {
    const { employeeId, currentPassword, newPassword } = req.body;
    if (!employeeId || !currentPassword || !newPassword)
      return res.status(400).json({ message: "All fields required" });
    if (newPassword.length < 6)
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    const user = await Employee.findById(employeeId);
    if (!user) return res.status(404).json({ message: "Employee not found" });
    const ok = await bcrypt.compare(currentPassword, user.password);
    if (!ok) return res.status(400).json({ message: "Current password is incorrect" });
    const hash = await bcrypt.hash(newPassword, 10);
    await Employee.updateOne({ _id: employeeId }, { $set: { password: hash } });
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
