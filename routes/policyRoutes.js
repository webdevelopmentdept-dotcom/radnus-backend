const express = require("express");
const router = express.Router();
const multer = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");
const auth = require("../middleware/auth"); 
const hrOnly = require("../middleware/hrOnly");

const {
  createPolicy, updatePolicy, getAllPolicies,
  acknowledgePolicy, getPolicyStats, deletePolicy
} = require("../controllers/policyController");

// ✅ Cloudinary — PDF + Images + Word docs எல்லாமே accept
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    return {
      folder: "policies",
      resource_type: "auto", // PDF, image, doc எல்லாமே
      public_id: `policy_${Date.now()}_${file.originalname.replace(/\s/g, "_")}`
    };
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/jpg",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error("Invalid file type"), false);
  },
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

router.get("/", getAllPolicies);
router.post("/", auth, hrOnly, upload.single("file"), createPolicy);
router.put("/:id", auth, hrOnly, upload.single("file"), updatePolicy);
router.post("/acknowledge", acknowledgePolicy);
router.get("/:id/stats", auth, hrOnly, getPolicyStats);
router.delete("/:id", auth, hrOnly, deletePolicy);

module.exports = router;