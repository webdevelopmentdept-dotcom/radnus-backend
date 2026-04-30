const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const Counter = require("../models/Counter");

const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const nodemailer = require("nodemailer");
const crypto = require("crypto");

// ================= CLOUDINARY STORAGE =================
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: "documents",
      resource_type: "auto",
      public_id: Date.now() + "-" + file.originalname
    };
  }
});


// ================= MULTER =================
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {

    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type: " + file.mimetype), false);
    }
  }
});

// ================= AUTO EMPLOYEE ID GENERATOR =================
// const generateEmployeeId = async () => {
//   const existingCount = await Employee.countDocuments();
//   const counter = await Counter.findOneAndUpdate(
//     { name: "employeeId" },
//     { $set: { seq: existingCount + 1 } },
//     { new: true, upsert: true }
//   );
//   return "EMP-" + String(counter.seq).padStart(3, "0");
// };

const generateEmployeeId = async () => {

  const counter = await Counter.findOneAndUpdate(
    { name: "employeeId" },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );

  return "EMP-" + String(counter.seq).padStart(3, "0");
};

// ================= REGISTER =================
router.post("/register", async (req, res) => {

  try {

    const { name, email, password, mobile, department, designation } = req.body;

    // check required fields
    if (!name || !email || !password || !mobile || !department || !designation) {
      return res.status(400).json({ message: "ALL_FIELDS_REQUIRED" });
    }

    // check email already exists
    const existingEmail = await Employee.findOne({ email });

    if (existingEmail) {
      return res.status(400).json({
        message: "EMAIL_ALREADY_REGISTERED"
      });
    }

    // check mobile already exists
    const existingMobile = await Employee.findOne({ mobile });

    if (existingMobile) {
      return res.status(400).json({
        message: "MOBILE_ALREADY_REGISTERED"
      });
    }

    // hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // create employee
    const employee = new Employee({
      employeeId: await generateEmployeeId(),
      name,
      email,
      password: hashedPassword,
      mobile,
      department,
      designation,
      documentsCompleted: false,
      status: "pending"
    });

    await employee.save();

    res.status(201).json({
      message: "REGISTER_SUCCESS",
      employeeId: employee.employeeId
    });

  } catch (err) {
    console.log("REGISTER ERROR:", err);

    res.status(500).json({
      message: err.message
    });
  }

});


// ================= LOGIN =================
router.post("/login", async (req, res) => {

  try {

    const { email, password } = req.body;

    const user = await Employee.findOne({ email });

    if (!user)
      return res.status(400).json({ message: "Invalid email" });

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch)
      return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign({ id: user._id }, "SECRETKEY", {
      expiresIn: "7d"
    });

    res.json({
      token,
      documentsCompleted: !!user.documentsCompleted,
      id: user._id,
       employeeId: user.employeeId 
    });

  } catch {

    res.status(500).json({ message: "Server error" });

  }

});


// ================= UPLOAD DOCUMENT =================
router.post("/upload-doc", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const { employeeId, docType } = req.body;

      if (!employeeId)
        return res.status(400).json({ message: "EMPLOYEE_ID_MISSING" });

      if (!req.file)
        return res.status(400).json({ message: "NO_FILE_UPLOADED" });

      const existingDoc = await Document.findOne({ employeeId, docType });
      if (existingDoc)
        return res.status(400).json({ message: "DOCUMENT_ALREADY_UPLOADED" });

      const newDoc = new Document({
        employeeId,
        docType,
        fileUrl: req.file.path
      });

      await newDoc.save();

      // ✅ UPDATED: Ration Card Front & Back added as required docs
      const requiredDocs = [
        "Aadhaar",
        "PAN",
        "Passport Photo",
        "10th Marksheet",
        "12th Marksheet",
        "Resume",
        "Bank Passbook",
        "Ration Card Front",
        "Ration Card Back"
      ];

      const uploadedDocs = await Document.find({ employeeId });
      const uploadedTypes = uploadedDocs.map(d => d.docType);
      const allUploaded = requiredDocs.every(doc => uploadedTypes.includes(doc));

      await Employee.findByIdAndUpdate(employeeId, {
        status: "pending",
        documentsCompleted: allUploaded ? true : undefined
      });

      res.json({
        message: "Uploaded successfully",
        fileUrl: req.file.path
      });

    } catch {
      res.status(500).json({ message: "Upload failed" });
    }
  });
});


// ================= REPLACE DOCUMENT =================
router.post("/replace-doc", (req, res) => {

  upload.single("file")(req, res, async (err) => {

    if (err)
      return res.status(400).json({ message: err.message });

    try {

      const { docId } = req.body;

      const doc = await Document.findById(docId);

      if (!doc)
        return res.status(404).json({ message: "Document not found" });

      const updated = await Document.findByIdAndUpdate(
        docId,
        { fileUrl: req.file.path },
        { new: true }
      );

      await Employee.findByIdAndUpdate(doc.employeeId, {
        status: "pending",
        remarks: "",
        reuploaded: true
      });

      res.json(updated);

    } catch {

      res.status(500).json({ message: "Replace failed" });

    }

  });

});


// ================= PROFILE IMAGE =================
router.post("/upload-profile", (req, res) => {

  upload.single("file")(req, res, async (err) => {

    if (err)
      return res.status(400).json({ message: err.message });

    try {

      const { employeeId } = req.body;

      const user = await Employee.findByIdAndUpdate(
        employeeId,
        { profileImage: req.file.path },
        { new: true }
      );

      res.json({ message: "Profile uploaded", user });

    } catch {

      res.status(500).json({ message: "Upload failed" });

    }

  });

});


// ================= COMPLETE DOCUMENTS =================
router.put("/complete-documents", async (req, res) => {
  try {
    const { employeeId } = req.body;

    // ✅ UPDATED: Ration Card Front & Back added as required docs
    const requiredDocs = [
      "Aadhaar",
      "PAN",
      "Passport Photo",
      "10th Marksheet",
      "12th Marksheet",
      "Resume",
      "Bank Passbook"
      // "Ration Card Front",
      // "Ration Card Back"
    ];

    const uploaded = await Document.find({ employeeId });
    const types = uploaded.map(d => d.docType);
    const ok = requiredDocs.every(doc => types.includes(doc));

    if (!ok)
      return res.status(400).json({ message: "UPLOAD_ALL_REQUIRED_DOCS_FIRST" });

    await Employee.findByIdAndUpdate(employeeId, {
      documentsCompleted: true
    });

    res.json({ message: "Documents completed" });

  } catch {
    res.status(500).json({ message: "Error updating" });
  }
});


// ================= GET USER =================
router.get("/me/:id", async (req, res) => {

  try {

    const user = await Employee.findById(req.params.id);

    const documents = await Document.find({
      employeeId: req.params.id
    });

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      altMobile: user.altMobile,
      dob: user.dob,
      address: user.address,
      department: user.department,
      designation: user.designation,
      status: user.status,
      remarks: user.remarks,
      documentsCompleted: !!user.documentsCompleted,
      profileImage: user.profileImage,
      documents
    });

  } catch {

    res.status(500).json({ message: "Error fetching user" });

  }

});


// ================= UPDATE PROFILE =================
// router.put("/update-profile", async (req, res) => {

//   try {

//     const {
//       employeeId,
//       name,
//       email,
//       mobile,
//       altMobile,
//       dob,
//       address,
//       department,
//       designation
//     } = req.body;

//     const updatedEmployee = await Employee.findByIdAndUpdate(
//       employeeId,
//       { name, email, mobile, altMobile, dob, address, department, designation },
//       { new: true }
//     );
//     res.json(updatedEmployee);

//   } catch {

//     res.status(500).json({ message: "Profile update failed" });

//   }

// });

router.put("/update-profile", async (req, res) => {
  try {
    const { employeeId, name, email, mobile, altMobile, dob, address, department, designation } = req.body;

    console.log("🔍 UPDATE BODY:", req.body); // ✅ இந்த line add பண்ணு

    const updatedEmployee = await Employee.findByIdAndUpdate(
      employeeId,
      { name, email, mobile, altMobile, dob, address, department, designation },
      { new: true }
    );

    console.log("✅ UPDATED:", updatedEmployee); // ✅ இந்த line add பண்ணு

    res.json(updatedEmployee);
  } catch(err) {
    console.log("❌ ERROR:", err);
    res.status(500).json({ message: "Profile update failed" });
  }
});
// ================= DELETE EMPLOYEE =================
router.delete("/employees/:id", async (req, res) => {
  try {

    const employeeId = req.params.id;

    // delete employee
    await Employee.findByIdAndDelete(employeeId);

    // delete all documents of employee
    await Document.deleteMany({ employeeId });

    res.json({
      message: "Employee deleted successfully"
    });

  } catch (error) {

    console.log(error);

    res.status(500).json({
      message: "Delete failed"
    });

  }
});

// ✅ GET /api/employees — status filter with
router.get("/employees", async (req, res) => {
  try {
    const { status } = req.query;
    const filter = status ? { status } : {};
    const employees = await Employee.find(filter);
    res.json({ total: employees.length, data: employees });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ✅ GET /api/employees/department-distribution
router.get("/employees/department-distribution", async (req, res) => {
  try {
    const dist = await Employee.aggregate([
      { $group: { _id: "$department", count: { $sum: 1 } } },
      { $project: { department: "$_id", count: 1, _id: 0 } }
    ]);
    res.json({ data: dist });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});
// ================= SAVE SOCIAL LINK (LinkedIn / Facebook) =================
// Add this route to your employee.js file (before module.exports)

router.post("/save-link", async (req, res) => {
  try {
    const { employeeId, docType, url } = req.body;

    if (!employeeId) return res.status(400).json({ message: "EMPLOYEE_ID_MISSING" });
    if (!url) return res.status(400).json({ message: "URL_MISSING" });

    // Check if already exists
    const existingDoc = await Document.findOne({ employeeId, docType });

    if (existingDoc) {
      // Update existing
      await Document.findByIdAndUpdate(existingDoc._id, { fileUrl: url });
    } else {
      // Create new
      await Document.create({ employeeId, docType, fileUrl: url });
    }

    // Set status to pending so HR can see it
    await Employee.findByIdAndUpdate(employeeId, { status: "pending" });

    res.json({ message: "Link saved successfully" });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Failed to save link" });
  }
});


// ================= GET EMPLOYEE BY EMPLOYEE ID =================
router.get("/employees/:id", async (req, res) => {
  try {
    const employee = await Employee.findOne({ employeeId: req.params.id }); // ✅ employeeId மூலம் தேடு
    if (!employee)
      return res.status(404).json({ message: "Employee not found" });
    res.json({ data: employee });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});


// ================= FORGOT PASSWORD =================
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;

    const user = await Employee.findOne({ email });
    if (!user)
      return res.status(404).json({ message: "EMAIL_NOT_FOUND" });

    // Generate secure token
    const token = crypto.randomBytes(32).toString("hex");
    const expiry = Date.now() + 15 * 60 * 1000; // 15 minutes

    // Save token + expiry to employee
    await Employee.findByIdAndUpdate(user._id, {
      resetPasswordToken: token,
      resetPasswordExpiry: expiry,
    });

    // Build reset link
    const resetLink = `${process.env.FRONTEND_URL}/employee/reset-password/${token}`;

    // Send email
    const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false,
  auth: {
    user: process.env.MAIL_USER,
    pass: process.env.MAIL_PASS,
  },
});



    await transporter.sendMail({
      from: `"HR Portal Radnus" <${process.env.MAIL_USER}>`,
      to: user.email,
      subject: "Reset Your Password — HR Portal",
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

    res.json({ message: "RESET_LINK_SENT" });

  } catch (err) {
    console.log("FORGOT PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});


// ================= RESET PASSWORD =================
router.post("/reset-password", async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    const user = await Employee.findOne({
      resetPasswordToken: token,
      resetPasswordExpiry: { $gt: Date.now() }, // not expired
    });

    if (!user)
      return res.status(400).json({ message: "TOKEN_INVALID_OR_EXPIRED" });

    const hashed = await bcrypt.hash(newPassword, 10);

    await Employee.findByIdAndUpdate(user._id, {
      password: hashed,
      resetPasswordToken: undefined,
      resetPasswordExpiry: undefined,
    });

    res.json({ message: "PASSWORD_RESET_SUCCESS" });

  } catch (err) {
    console.log("RESET PASSWORD ERROR:", err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;