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
      id: user._id
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
      "Bank Passbook",
      "Ration Card Front",
      "Ration Card Back"
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
router.put("/update-profile", async (req, res) => {

  try {

    const {
      employeeId,
      name,
      email,
      mobile,
      department,
      designation
    } = req.body;

    const updatedEmployee = await Employee.findByIdAndUpdate(
      employeeId,
      { name, email, mobile, department, designation },
      { new: true }
    );

    res.json(updatedEmployee);

  } catch {

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
    if (!url)        return res.status(400).json({ message: "URL_MISSING" });

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

module.exports = router;