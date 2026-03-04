const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");

// ✅ Cloudinary
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

// ================== CLOUDINARY STORAGE ==================
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    console.log("BODY:", req.body);   // 🔥 debug
    console.log("FILE TYPE:", file.mimetype);

    return {
      folder: "resumes", // 🔥 test folder
      resource_type: "auto", // 🔥 IMPORTANT
      public_id: Date.now() + "-" + file.originalname
    };
  }
});

// ================== MULTER ==================
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

// ================== REGISTER ==================
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, mobile, department, designation } = req.body;

    const existing = await Employee.findOne({ email });
    if (existing) return res.status(400).json({ message: "EMPLOYEE_EXISTS" });

    const hashedPassword = await bcrypt.hash(password, 10);

    const employee = new Employee({
      employeeId: "EMP" + Date.now(),
      name,
      email,
      password: hashedPassword,
      mobile,
      department,
      designation,
      documentsCompleted: false
    });

    await employee.save();

    res.json({ message: "REGISTER_SUCCESS" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ================== LOGIN ==================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Employee.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid email" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid password" });

    const token = jwt.sign({ id: user._id }, "SECRETKEY", { expiresIn: "7d" });

    res.json({
      token,
      documentsCompleted: user.documentsCompleted,
      id: user._id
    });

  } catch {
    res.status(500).json({ message: "Server error" });
  }
});

// ================== UPLOAD DOCUMENT ==================
router.post("/upload-doc", (req, res) => {
  upload.single("file")(req, res, async (err) => {

    if (err) {
      console.log("UPLOAD ERROR:", err.message);
      return res.status(400).json({ message: err.message });
    }

    try {
      const { employeeId, docType } = req.body;

      if (!employeeId) {
        return res.status(400).json({ message: "EMPLOYEE_ID_MISSING" });
      }

      if (!req.file) {
        return res.status(400).json({ message: "NO_FILE_UPLOADED" });
      }

      const existingDoc = await Document.findOne({ employeeId, docType });

      if (existingDoc) {
        return res.status(400).json({ message: "DOCUMENT_ALREADY_UPLOADED" });
      }

      const newDoc = new Document({
        employeeId,
        docType,
        fileUrl: req.file.path
      });

      await newDoc.save();

      // 🔥 CHECK REQUIRED DOCUMENTS
      const requiredDocs = [
        "Aadhaar",
        "PAN",
        "Passport Photo",
        "10th Marksheet",
        "12th Marksheet",
        "Resume"
      ];

      const uploadedDocs = await Document.find({ employeeId });

      const uploadedTypes = uploadedDocs.map(d => d.docType);

      const allUploaded = requiredDocs.every(doc =>
        uploadedTypes.includes(doc)
      );

      // 🔥 UPDATE EMPLOYEE
      if (allUploaded) {
        await Employee.findByIdAndUpdate(employeeId, {
          documentsCompleted: true
        });

        console.log("✅ All required docs uploaded. Employee verified.");
      }

      res.json({
        message: "Uploaded successfully",
        fileUrl: req.file.path
      });

    } catch (err) {
      console.log(err);
      res.status(500).json({ message: "Upload failed" });
    }

  });
});

// ================== REPLACE DOCUMENT ==================
router.post("/replace-doc", (req, res) => {
  upload.single("file")(req, res, async (err) => {

    if (err) {
      return res.status(400).json({ message: err.message });
    }

    try {
      const { docId } = req.body;

      const doc = await Document.findById(docId);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      const updated = await Document.findByIdAndUpdate(
        docId,
        { fileUrl: req.file.path },
        { new: true }
      );

      await Employee.findByIdAndUpdate(doc.employeeId, {
        status: "pending",
        remarks: "",
        reuploaded: true,
        documentsCompleted: false
      });

      res.json(updated);

    } catch {
      res.status(500).json({ message: "Replace failed" });
    }

  });
});

// ================== PROFILE IMAGE ==================
router.post("/upload-profile", (req, res) => {
  upload.single("file")(req, res, async (err) => {

    if (err) return res.status(400).json({ message: err.message });

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

// ================== COMPLETE ==================
router.put("/complete-documents", async (req, res) => {
  try {
    const { employeeId } = req.body;

    const requiredDocs = [
      "Aadhaar",
      "PAN",
      "Passport Photo",
      "10th Marksheet",
      "12th Marksheet",
      "Resume"
    ];

    const uploaded = await Document.find({ employeeId });
    const types = uploaded.map(d => d.docType);

    const ok = requiredDocs.every(doc => types.includes(doc));

    if (!ok) {
      return res.status(400).json({ message: "UPLOAD_ALL_REQUIRED_DOCS_FIRST" });
    }

    await Employee.findByIdAndUpdate(employeeId, {
      documentsCompleted: true
    });

    res.json({ message: "Documents completed" });

  } catch {
    res.status(500).json({ message: "Error updating" });
  }
});

// ================== GET USER ==================
router.get("/me/:id", async (req, res) => {
  try {
    const user = await Employee.findById(req.params.id);
    const documents = await Document.find({ employeeId: req.params.id });

    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      mobile: user.mobile,
      department: user.department,
      designation: user.designation,
      status: user.status,
      remarks: user.remarks,
      documentsCompleted: user.documentsCompleted,
      profileImage: user.profileImage,
      documents
    });

  } catch {
    res.status(500).json({ message: "Error fetching user" });
  }
});
// ================== UPDATE PROFILE ==================
router.put("/update-profile", async (req, res) => {
  try {

    const { employeeId, name, email, mobile, department, designation } = req.body;

    const updatedEmployee = await Employee.findByIdAndUpdate(
      employeeId,
      {
        name,
        email,
        mobile,
        department,
        designation
      },
      { new: true }
    );

    if (!updatedEmployee) {
      return res.status(404).json({ message: "Employee not found" });
    }

    res.json(updatedEmployee);

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Profile update failed" });
  }
});
// ================== DELETE EMPLOYEE ==================
router.delete("/employees/:id", async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);

    if (!emp) {
      return res.status(404).json({ message: "Employee not found" });
    }

    // 🔥 delete related documents also (important)
    await Document.deleteMany({ employeeId: req.params.id });

    await Employee.findByIdAndDelete(req.params.id);

    res.json({ message: "Employee deleted successfully" });

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;