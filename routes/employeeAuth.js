const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Document = require("../models/Document");
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

/* ================= CLOUDINARY + MULTER ================= */

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "resumes",
    resource_type: "auto",
    public_id: Date.now() + "-" + file.originalname.replace(/\s+/g, "_"),
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "image/jpeg", "image/png", "image/jpg",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type"), false);
  },
});

/* ================= HELPER: EXTRACT CLOUDINARY URL ================= */

// multer-storage-cloudinary stores fields differently across versions.
// This helper safely extracts the URL and publicId regardless of version.
const extractCloudinaryFields = (file) => {
  console.log("🔍 FULL req.file:", JSON.stringify(file, null, 2));

  const fileUrl =
    file.path ||          // v4.x — most common
    file.secure_url ||    // v3.x
    file.url ||           // fallback
    (file.cloudinary && file.cloudinary.secure_url); // nested fallback

  const publicId =
    file.filename ||      // v4.x
    file.public_id ||     // v3.x
    (file.cloudinary && file.cloudinary.public_id);

  console.log("✅ Extracted fileUrl:", fileUrl);
  console.log("✅ Extracted publicId:", publicId);

  return { fileUrl, publicId };
};

/* ================= UPLOAD DOCUMENT ================= */

router.post("/upload-doc", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      console.log("❌ Multer/Cloudinary error:", err.message);
      return res.status(400).json({ message: err.message });
    }

    try {
      const { employeeId, docType } = req.body;

      console.log("📦 BODY:", req.body);

      if (!employeeId)
        return res.status(400).json({ message: "EMPLOYEE_ID_MISSING" });

      if (!req.file)
        return res.status(400).json({ message: "NO_FILE_UPLOADED" });

      const { fileUrl, publicId } = extractCloudinaryFields(req.file);

      if (!fileUrl) {
        console.log("❌ fileUrl is undefined. req.file keys:", Object.keys(req.file));
        return res.status(500).json({
          message: "Cloudinary URL missing. Check server logs.",
          fileKeys: Object.keys(req.file), // helps debug version mismatch
        });
      }

      // Check duplicate
      const existing = await Document.findOne({ employeeId, docType });
      if (existing) {
        return res.status(400).json({ message: "DOCUMENT_ALREADY_UPLOADED" });
      }

      const newDoc = new Document({
        employeeId,
        docType,
        fileUrl,
        publicId,
      });

      await newDoc.save();
      console.log("✅ Saved to MongoDB:", newDoc);

      res.json({ message: "Uploaded successfully", fileUrl });

    } catch (err) {
      // 🔥 Show full Mongoose validation error
      console.log("❌ SAVE ERROR:", err.message);
      if (err.errors) {
        Object.keys(err.errors).forEach(key => {
          console.log(`   • ${key}: ${err.errors[key].message}`);
        });
      }
      res.status(500).json({ message: err.message || "Upload failed" });
    }
  });
});

/* ================= REPLACE DOCUMENT ================= */

router.post("/replace-doc", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const { docId } = req.body;

      const doc = await Document.findById(docId);
      if (!doc) return res.status(404).json({ message: "Document not found" });

      // Delete old file from Cloudinary
      if (doc.publicId) {
        try {
          await cloudinary.uploader.destroy(doc.publicId);
          console.log("🗑️ Deleted old Cloudinary file:", doc.publicId);
        } catch (cloudErr) {
          console.log("⚠️ Cloudinary delete failed:", cloudErr.message);
        }
      }

      const { fileUrl, publicId } = extractCloudinaryFields(req.file);

      if (!fileUrl) {
        return res.status(500).json({ message: "Cloudinary URL missing from upload response" });
      }

      doc.fileUrl = fileUrl;
      doc.publicId = publicId;
      await doc.save();

      await Employee.findByIdAndUpdate(doc.employeeId, {
        documentsCompleted: false,
        status: "pending",
      });

      res.json({ message: "Replaced successfully", doc });

    } catch (err) {
      console.log("❌ Replace error:", err.message);
      res.status(500).json({ message: err.message || "Replace failed" });
    }
  });
});

/* ================= UPLOAD PROFILE IMAGE ================= */

const profileStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "profile_images",
    resource_type: "image",
    public_id: "profile-" + Date.now(),
  }),
});

const profileUpload = multer({ storage: profileStorage });

router.post("/upload-profile", (req, res) => {
  profileUpload.single("file")(req, res, async (err) => {
    if (err) return res.status(400).json({ message: err.message });

    try {
      const { employeeId } = req.body;

      if (!req.file)
        return res.status(400).json({ message: "NO_FILE_UPLOADED" });

      const { fileUrl } = extractCloudinaryFields(req.file);

      if (!fileUrl)
        return res.status(500).json({ message: "Cloudinary URL missing" });

      await Employee.findByIdAndUpdate(employeeId, { profileImage: fileUrl });

      res.json({ message: "Profile image updated", profileImage: fileUrl });

    } catch (err) {
      console.log("❌ Profile upload error:", err.message);
      res.status(500).json({ message: err.message || "Upload failed" });
    }
  });
});

/* ================= UPDATE PROFILE ================= */

router.put("/update-profile", async (req, res) => {
  try {
    const { employeeId, name, email, mobile, department, designation } = req.body;

    await Employee.findByIdAndUpdate(employeeId, {
      name, email, mobile, department, designation,
    });

    res.json({ message: "Profile updated successfully" });

  } catch (err) {
    console.log("❌ Update profile error:", err.message);
    res.status(500).json({ message: err.message || "Update failed" });
  }
});

/* ================= COMPLETE DOCUMENTS ================= */

router.put("/complete-documents", async (req, res) => {
  try {
    const { employeeId } = req.body;
    console.log("PUT employeeId:", employeeId);

    const requiredDocs = [
      "Aadhaar", "PAN", "Passport Photo",
      "10th Marksheet", "12th Marksheet", "Resume",
    ];

    const uploaded = await Document.find({ employeeId });
    const uploadedTypes = uploaded.map((d) => d.docType);

    const allUploaded = requiredDocs.every((doc) => uploadedTypes.includes(doc));

    if (!allUploaded) {
      return res.status(400).json({ message: "UPLOAD_ALL_REQUIRED_DOCS_FIRST" });
    }

    await Employee.findByIdAndUpdate(employeeId, { documentsCompleted: true });

    res.json({ message: "Documents completed" });

  } catch (err) {
    console.log("❌ Complete docs error:", err.message);
    res.status(500).json({ message: err.message || "Error updating" });
  }
});

/* ================= GET USER ================= */

router.get("/me/:id", async (req, res) => {
  try {
    const user = await Employee.findById(req.params.id);

    if (!user) return res.status(404).json({ message: "Employee not found" });

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
      profileImage: user.profileImage || null,
      documentsCompleted: user.documentsCompleted,
      reuploaded: user.reuploaded,
      documents,
    });

  } catch (err) {
    console.log("❌ Get user error:", err.message);
    res.status(500).json({ message: err.message || "Error fetching user" });
  }
});

module.exports = router;