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
        type: "document",
        title: "Documents Submitted",
        message: `${emp.name} submitted all documents`,
        link: "",
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
// router.post('/login', async (req, res) => {
//   try {
//     const { email, password } = req.body;

//     const user = await Employee.findOne({ email });
//     if (!user) return res.status(400).json({ message: 'Invalid email' });

//     const isMatch = await bcrypt.compare(password, user.password);
//     if (!isMatch) return res.status(400).json({ message: 'Invalid password' });

//     const token = jwt.sign({ id: user._id }, 'SECRETKEY', { expiresIn: '7d' });

//     res.json({
//       token,
//       documentsCompleted: !!user.documentsCompleted,
//       id: user._id,
//       employeeId: user.employeeId,
//     });
//   } catch {
//     res.status(500).json({ message: 'Server error' });
//   }
// });

// ================= LOGIN =================
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Employee.findOne({ email });
    if (!user) return res.status(400).json({ message: 'Invalid email' });

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

      await Employee.findByIdAndUpdate(employeeId, {
        ...(isHrUpload ? {} : { status: 'pending' }),
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
    if (!docType)    return res.status(400).json({ message: 'DOC_TYPE_MISSING' });

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
    const hasRation  = types.includes('Ration Card Front') && types.includes('Ration Card Back');
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
router.get('/employees', async (req, res) => {
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


// ================= RELIEVE EMPLOYEE =================
router.patch('/employees/:id/relieve', async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    await Employee.findByIdAndUpdate(req.params.id, {
      exitType: 'relieved',
      accessDeactivated: false,
      status: 'relieved',
    });

    res.json({ message: 'Employee marked as relieved' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to update' });
  }
});

// ================= FIRE EMPLOYEE =================
router.patch('/employees/:id/fire', async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    await Employee.findByIdAndUpdate(req.params.id, {
      exitType: 'fired',
      accessDeactivated: false,
      status: 'fired',
    });

    res.json({ message: 'Employee marked as fired' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to update' });
  }
});

// ================= DEACTIVATE ACCESS =================
router.patch('/employees/:id/deactivate-access', async (req, res) => {
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
// ================= REACTIVATE EMPLOYEE =================
router.patch('/employees/:id/reactivate', async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ message: 'Employee not found' });

    await Employee.findByIdAndUpdate(req.params.id, {
      exitType: null,
      accessDeactivated: false,
      status: 'active',
    });

    res.json({ message: 'Employee reactivated successfully' });
  } catch (err) {
    console.log(err);
    res.status(500).json({ message: 'Failed to reactivate' });
  }
});


// ================= DELETE EMPLOYEE =================
router.delete('/employees/:id', async (req, res) => {
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
router.get('/employees/:id', async (req, res) => {
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
router.get('/view-doc/:docId', async (req, res) => {
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
router.post('/employees/migrate-shifts', async (req, res) => {
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
router.put('/employees/:id/shift', async (req, res) => {
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

module.exports = router;
