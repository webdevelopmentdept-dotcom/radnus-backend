const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const multer = require("multer");
const path = require("path");
const API_BASE = import.meta.env.VITE_API_BASE_URL;

// ================== MULTER SETUP ==================
const storage = multer.diskStorage({
  destination: "uploads/",
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid file type"), false);
    }
  }
});

// ================== REGISTER ==================
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, mobile, department, designation } = req.body;

    const existing = await Employee.findOne({ email });

    if (existing) {
      return res.status(400).json({ message: "EMPLOYEE_EXISTS" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    // 🔥 👉 இங்க தான் change பண்ணணும்
    const employee = new Employee({
      employeeId: "EMP" + Date.now(), // ✅ ADD HERE
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
    console.error(err);
    res.status(500).json({ message: err.message });
  }
});

// ================== LOGIN ==================
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await Employee.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid email" });
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).json({ message: "Invalid password" });
    }

    const token = jwt.sign(
      { id: user._id },
      "SECRETKEY",
      { expiresIn: "7d" }
    );

   res.json({
  token,
  documentsCompleted: user.documentsCompleted,
  id: user._id   // ✅ ADD THIS LINE
});

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});
router.delete("/delete-doc/:id", async (req, res) => {
  try {
    await Document.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Delete failed" });
  }
});
router.post("/replace-doc", upload.single("file"), async (req, res) => {
  try {
    const { docId } = req.body;

    const doc = await Document.findById(docId);

if (!doc) {
  return res.status(404).json({ message: "Document not found" });
}

    // 🔥 UPDATE DOCUMENT
    const updated = await Document.findByIdAndUpdate(
      docId,
      {
        fileUrl: `${API_BASE}/uploads/${req.file.filename}`
      },
      { new: true }
    );

    
    await Employee.findByIdAndUpdate(doc.employeeId, {
  status: "pending",
  remarks: "",
  reuploaded: true,
  documentsCompleted: false  // 🔥 ADD THIS
});

    res.json(updated);

  } catch (err) {
    res.status(500).json({ message: "Replace failed" });
  }
});

router.put("/update-documents", async (req, res) => {
  try {
    const { documents } = req.body;

    for (let doc of documents) {
      await Document.findByIdAndUpdate(doc._id, doc);
    }

    res.json({ message: "Documents updated" });
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});
// ================== UPLOAD DOCUMENT ==================
router.post("/upload-doc", upload.single("file"), async (req, res) => {
  try {
    console.log("BODY:", req.body);
    console.log("FILE:", req.file);

    const { employeeId, docType } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: "EMPLOYEE_ID_MISSING" });
    }

    if (!req.file) {
      return res.status(400).json({ message: "NO_FILE_UPLOADED" });
    }

    const existingDoc = await Document.findOne({
      employeeId,
      docType
    });

    if (existingDoc) {
      return res.status(400).json({
        message: "DOCUMENT_ALREADY_UPLOADED"
      });
    }

    const newDoc = new Document({
      employeeId,
      docType,
     fileUrl: `${API_BASE}/uploads/${req.file.filename}`
    });

    await newDoc.save();

    res.json({
      message: "Uploaded successfully",
      file: req.file.filename,
      docType
    });

  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ message: "Upload failed" });
  }
});

router.put("/complete-documents", async (req, res) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({ message: "ID_MISSING" });
    }

    const requiredDocs = [
      "Aadhaar",
      "PAN",
      "Passport Photo",
      "10th Marksheet",
      "12th Marksheet",
      "Resume"
    ];

    const uploadedDocs = await Document.find({ employeeId });

    const uploadedTypes = uploadedDocs.map(doc => doc.docType);

    const allUploaded = requiredDocs.every(doc =>
      uploadedTypes.includes(doc)
    );

    if (!allUploaded) {
      return res.status(400).json({
        message: "UPLOAD_ALL_REQUIRED_DOCS_FIRST"
      });
    }

    await Employee.findByIdAndUpdate(employeeId, {
      documentsCompleted: true
    });

    res.json({ message: "Documents completed" });

  } catch (err) {
    console.log(err);
    res.status(500).json({ message: "Error updating" });
  }
});
router.get("/me/:id", async (req, res) => {
  try {
    const user = await Employee.findById(req.params.id);

    if (!user) {
      return res.status(404).json({ message: "USER_NOT_FOUND" });
    }

    const documents = await Document.find({
      employeeId: req.params.id
    });
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
  profileImage: user.profileImage, // ✅ ADD THIS
  documents
});

  } catch (err) {
    res.status(500).json({ message: "Error fetching user" });
  }
});
router.post("/upload-profile", upload.single("file"), async (req, res) => {
  try {
    const { employeeId } = req.body;

    const user = await Employee.findByIdAndUpdate(
      employeeId,
      {
        profileImage: `${API_BASE}/uploads/${req.file.filename}`
      },
      { new: true }
    );

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Upload failed" });
  }
});
router.put("/update-profile", async (req, res) => {
  try {
    const { employeeId, ...data } = req.body;

    const user = await Employee.findByIdAndUpdate(
      employeeId,
      data,
      { new: true }
    );

    res.json(user);
  } catch (err) {
    res.status(500).json({ message: "Update failed" });
  }
});
// ================== GET USER DOCUMENTS ==================
router.get("/my-docs/:employeeId", async (req, res) => {
  try {
    const docs = await Document.find({
      employeeId: req.params.employeeId
    });

    res.json(docs);

  } catch (err) {
    res.status(500).json({ message: "Error fetching documents" });
  }
});
router.get("/all-docs", async (req, res) => {
  try {
    const docs = await Document.find().populate("employeeId");
    res.json(docs);
  } catch (err) {
    res.status(500).json({ message: "Error fetching docs" });
  }
});
module.exports = router;