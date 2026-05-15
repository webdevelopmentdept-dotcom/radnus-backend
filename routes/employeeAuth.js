const express  = require('express');
const router   = express.Router();
const Employee = require('../models/Employee');
const Document = require('../models/Document');
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const multer   = require('multer');
const Counter  = require('../models/Counter');
const axios    = require('axios');

const { CloudinaryStorage } = require('multer-storage-cloudinary');
const cloudinary = require('../config/cloudinary');

const { Resend } = require('resend');
const crypto = require('crypto');

// ─── eSSL Server URL ─────────────────────────────────────────
// HRMS backend .env-ல் இதை add பண்ணு:
// ESSL_SERVER_URL=http://192.168.0.70:5000
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

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: 'Invalid password' });

    const token = jwt.sign({ id: user._id }, 'SECRETKEY', { expiresIn: '7d' });

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
      if (!req.file)   return res.status(400).json({ message: 'NO_FILE_UPLOADED' });

      const existingDoc = await Document.findOne({ employeeId, docType });
      if (existingDoc) return res.status(400).json({ message: 'DOCUMENT_ALREADY_UPLOADED' });

      const newDoc = new Document({
        employeeId,
        docType,
        fileUrl: req.file.path,
      });
      await newDoc.save();

      const requiredDocs = [
        'Aadhaar', 'PAN', 'Passport Photo',
        '10th Marksheet', '12th Marksheet',
        'Resume', 'Bank Passbook',
        'Ration Card Front', 'Ration Card Back',
      ];

      const uploadedDocs  = await Document.find({ employeeId });
      const uploadedTypes = uploadedDocs.map(d => d.docType);
      const allUploaded   = requiredDocs.every(doc => uploadedTypes.includes(doc));

      await Employee.findByIdAndUpdate(employeeId, {
        status: 'pending',
        documentsCompleted: allUploaded ? true : undefined,
      });

      res.json({ message: 'Uploaded successfully', fileUrl: req.file.path });
    } catch {
      res.status(500).json({ message: 'Upload failed' });
    }
  });
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

      await Employee.findByIdAndUpdate(doc.employeeId, {
        status: 'pending',
        remarks: '',
        reuploaded: true,
      });

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
    const types    = uploaded.map(d => d.docType);
    const ok       = requiredDocs.every(doc => types.includes(doc));

    if (!ok) return res.status(400).json({ message: 'UPLOAD_ALL_REQUIRED_DOCS_FIRST' });

    await Employee.findByIdAndUpdate(employeeId, { documentsCompleted: true });
    res.json({ message: 'Documents completed' });
  } catch {
    res.status(500).json({ message: 'Error updating' });
  }
});

// ================= GET USER =================
router.get('/me/:id', async (req, res) => {
  try {
    const user      = await Employee.findById(req.params.id);
    const documents = await Document.find({ employeeId: req.params.id });

    res.json({
      id:                 user._id,
      name:               user.name,
      email:              user.email,
      mobile:             user.mobile,
      altMobile:          user.altMobile,
      dob:                user.dob,
      address:            user.address,
      department:         user.department,
      designation:        user.designation,
      essl_id:            user.essl_id,
      status:             user.status,
      remarks:            user.remarks,
      documentsCompleted: !!user.documentsCompleted,
      profileImage:       user.profileImage,
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

// ================= DELETE EMPLOYEE =================
// ── eSSL sync added ──
router.delete('/employees/:id', async (req, res) => {
  try {
    const employeeId = req.params.id;

    const emp = await Employee.findById(employeeId);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    const esslId = emp.essl_id;

    await Employee.findByIdAndDelete(employeeId);
    await Document.deleteMany({ employeeId });

    // eSSL machine sync
    let esslResult = { ok: false, error: 'No eSSL ID' };
    if (esslId) {
      esslResult = await callEsslBridge('employee/delete', { essl_id: esslId });
      console.log(`🗑️  eSSL sync → Delete ${emp.name} (${esslId}) → ${esslResult.ok ? '✅' : '❌'}`);
    }

    res.json({
      message: 'Employee deleted successfully',
      essl_sync: {
        attempted: !!esslId,
        success:   esslResult.ok,
        message:   esslResult.ok ? 'Removed from machine' : (esslResult.error || ''),
      },
    });
  } catch (error) {
    console.log(error);
    res.status(500).json({ message: 'Delete failed' });
  }
});

// ================= GET ALL EMPLOYEES =================
router.get('/employees', async (req, res) => {
  try {
    const { status } = req.query;
    const filter     = status ? { status } : {};
    const employees  = await Employee.find(filter);
    res.json({ total: employees.length, data: employees });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================= DEPARTMENT DISTRIBUTION =================
router.get('/employees/department-distribution', async (req, res) => {
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

// ================= SAVE SOCIAL LINK =================
router.post('/save-link', async (req, res) => {
  try {
    const { employeeId, docType, url } = req.body;

    if (!employeeId) return res.status(400).json({ message: 'EMPLOYEE_ID_MISSING' });
    if (!url)        return res.status(400).json({ message: 'URL_MISSING' });

    const existingDoc = await Document.findOne({ employeeId, docType });
    if (existingDoc) {
      await Document.findByIdAndUpdate(existingDoc._id, { fileUrl: url });
    } else {
      await Document.create({ employeeId, docType, fileUrl: url });
    }

    await Employee.findByIdAndUpdate(employeeId, { status: 'pending' });
    res.json({ message: 'Link saved successfully' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to save link' });
  }
});

// ================= GET EMPLOYEE BY EMPLOYEE ID =================
router.get('/employees/:id', async (req, res) => {
  try {
    const employee = await Employee.findOne({ employeeId: req.params.id });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    res.json({ data: employee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  NEW: eSSL Employee Management Routes
//  HR இந்த routes use பண்ணி employee add/update + machine sync
// ═══════════════════════════════════════════════════════════════

// ── ADD EMPLOYEE (eSSL sync with) ────────────────────────────
// POST /api/essl/employees/add
router.post('/essl/employees/add', async (req, res) => {
  try {
    const {
      name, employeeId, essl_id,
      department, designation,
      mobile, email, status,
    } = req.body;

    if (!name) return res.status(400).json({ success: false, message: 'Name required' });

    // Duplicate essl_id check
    if (essl_id) {
      const dup = await Employee.findOne({ essl_id });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: `eSSL ID "${essl_id}" already assigned to ${dup.name}`,
        });
      }
    }

    // 1. Save to MongoDB
    const emp = await Employee.create({
      name,
      employeeId: employeeId || await generateEmployeeId(),
      essl_id:    essl_id || null,
      department, designation,
      mobile, email,
      status: status || 'active',
    });

    // 2. Sync to eSSL machine
    let esslResult = { ok: false, error: 'No eSSL ID — skipped' };
    if (essl_id) {
      esslResult = await callEsslBridge('employee/add', { essl_id, name });
      console.log(`🔗 eSSL Add: ${name} (${essl_id}) → ${esslResult.ok ? '✅' : '❌'}`);
    }

    res.json({
      success: true,
      message: 'Employee added successfully',
      data:    emp,
      essl_sync: {
        attempted: !!essl_id,
        success:   esslResult.ok,
        message:   esslResult.message || esslResult.error || '',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── UPDATE EMPLOYEE (eSSL sync with) ─────────────────────────
// PUT /api/essl/employees/:id
router.put('/essl/employees/:id', async (req, res) => {
  try {
    const {
      name, employeeId, essl_id,
      department, designation,
      mobile, email, status,
    } = req.body;

    const oldEmp = await Employee.findById(req.params.id);
    if (!oldEmp) return res.status(404).json({ success: false, message: 'Employee not found' });

    // Duplicate essl_id check (exclude self)
    if (essl_id) {
      const dup = await Employee.findOne({ essl_id, _id: { $ne: req.params.id } });
      if (dup) {
        return res.status(400).json({
          success: false,
          message: `eSSL ID "${essl_id}" already assigned to ${dup.name}`,
        });
      }
    }

    // 1. Update MongoDB
    const emp = await Employee.findByIdAndUpdate(
      req.params.id,
      { name, employeeId, essl_id: essl_id || null, department, designation, mobile, email, status },
      { new: true }
    );

    // 2. Sync to eSSL machine
    const oldEsslId = oldEmp.essl_id;
    const newEsslId = essl_id;
    let esslResult  = { ok: false, error: 'No eSSL ID — skipped' };

    if (newEsslId) {
      esslResult = await callEsslBridge('employee/update', {
        essl_id:     newEsslId,
        name:        name || oldEmp.name,
        old_essl_id: oldEsslId || null,
      });
      console.log(`🔗 eSSL Update: ${name} (${newEsslId}) → ${esslResult.ok ? '✅' : '❌'}`);
    } else if (oldEsslId && !newEsslId) {
      esslResult = await callEsslBridge('employee/delete', { essl_id: oldEsslId });
      console.log(`🗑️  eSSL: removed ${oldEsslId} from machine`);
    }

    res.json({
      success: true,
      message: 'Employee updated successfully',
      data:    emp,
      essl_sync: {
        attempted: !!(oldEsslId || newEsslId),
        success:   esslResult.ok,
        message:   esslResult.message || esslResult.error || '',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── SINGLE EMPLOYEE MANUAL SYNC ───────────────────────────────
// POST /api/essl/employees/:id/sync
router.post('/essl/employees/:id/sync', async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (!emp.essl_id) {
      return res.status(400).json({
        success: false,
        message: 'Employee has no eSSL ID. Edit and add one first.',
      });
    }

    const result = await callEsslBridge('employee/add', {
      essl_id: emp.essl_id,
      name:    emp.name,
    });

    console.log(`🔗 Manual sync: ${emp.name} (${emp.essl_id}) → ${result.ok ? '✅' : '❌'}`);

    res.json({
      success: result.ok,
      message: result.ok
        ? `${emp.name} synced to machine ✅`
        : `Sync failed: ${result.error}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── BULK SYNC ALL EMPLOYEES ───────────────────────────────────
// POST /api/essl/employees/sync-all
router.post('/essl/employees/sync-all', async (req, res) => {
  try {
    const employees = await Employee.find({
      essl_id: { $ne: null, $exists: true },
      status:  { $ne: 'inactive' },
    });

    const results = [];
    for (const emp of employees) {
      const r = await callEsslBridge('employee/add', {
        essl_id: emp.essl_id,
        name:    emp.name,
      });
      results.push({ name: emp.name, essl_id: emp.essl_id, success: r.ok });
    }

    const synced = results.filter(r => r.success).length;
    console.log(`🔗 Bulk sync: ${synced}/${results.length} employees synced`);

    res.json({
      success: true,
      total:   results.length,
      synced,
      failed:  results.length - synced,
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── MACHINE EMPLOYEE LIST ─────────────────────────────────────
// GET /api/essl/machine-list
router.get('/essl/machine-list', async (req, res) => {
  try {
    const resp = await axios.get(
      `${ESSL_SERVER}/essl-bridge/employees`,
      { timeout: 7000 }
    );

    const machineData   = resp.data;
    const hrmsEmployees = await Employee.find({ essl_id: { $ne: null } });
    const hrmsMap       = {};
    hrmsEmployees.forEach(e => { hrmsMap[e.essl_id] = e; });

    const enriched = (machineData.employees || []).map(e => ({
      ...e,
      in_hrms: !!hrmsMap[e.essl_id],
      hrms_record: hrmsMap[e.essl_id] ? {
        _id:        hrmsMap[e.essl_id]._id,
        name:       hrmsMap[e.essl_id].name,
        employeeId: hrmsMap[e.essl_id].employeeId,
        department: hrmsMap[e.essl_id].department,
      } : null,
    }));

    res.json({
      success:       true,
      machine_count: machineData.count || 0,
      hrms_linked:   enriched.filter(e => e.in_hrms).length,
      not_in_hrms:   enriched.filter(e => !e.in_hrms).length,
      employees:     enriched,
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      message: `Cannot reach eSSL server: ${err.message}`,
    });
  }
});

// ── MACHINE PING ──────────────────────────────────────────────
// GET /api/essl/ping
router.get('/essl/ping', async (req, res) => {
  try {
    const resp = await axios.get(
      `${ESSL_SERVER}/essl-bridge/ping`,
      { timeout: 4000 }
    );
    res.json(resp.data);
  } catch {
    res.json({ ok: false, status: 'essl-server-offline' });
  }
});

// ================= FORGOT PASSWORD =================
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;

    const user = await Employee.findOne({ email });
    if (!user) return res.status(404).json({ message: 'EMAIL_NOT_FOUND' });

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + 15 * 60 * 1000;

    await Employee.findByIdAndUpdate(user._id, {
      resetPasswordToken:  token,
      resetPasswordExpiry: expiry,
    });

    const resetLink = `${process.env.FRONTEND_URL}/employee/reset-password/${token}`;
    const resend    = new Resend(process.env.RESEND_API_KEY);

    await resend.emails.send({
      from:    'HR Portal <noreply@service.radnus.in>',
      to:      user.email,
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
      resetPasswordToken:  token,
      resetPasswordExpiry: { $gt: Date.now() },
    });

    if (!user) return res.status(400).json({ message: 'TOKEN_INVALID_OR_EXPIRED' });

    const hashed = await bcrypt.hash(newPassword, 10);

    await Employee.findByIdAndUpdate(user._id, {
      password:            hashed,
      resetPasswordToken:  undefined,
      resetPasswordExpiry: undefined,
    });

    res.json({ message: 'PASSWORD_RESET_SUCCESS' });
  } catch (err) {
    console.log('RESET PASSWORD ERROR:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;