const express = require("express");
const crypto = require("crypto");
const mongoose = require("mongoose");
const Lead = require("../models/Lead");
const Partner = require("../models/Partner");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const router = express.Router();

/* ================= MULTER STORAGE ================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "..", "uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});
const upload = multer({ storage });

/* ================= ADD LEAD AFTER PAYMENT ================= */
router.post("/add-after-payment", upload.single("proof"), async (req, res) => {
  try {
    const {
      name,
      phone,
      email,
      course,
      advance,
      partnerId,
      partnerName,
      razorpay_payment_id,
      razorpay_order_id,
      razorpay_signature,
    } = req.body;

    if (!name || !phone || !course || !advance || !partnerId) {
      return res.json({ success: false, message: "Missing fields" });
    }

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(body)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      return res.json({ success: false, message: "Payment verification failed" });
    }

    const proofPath = req.file ? `/uploads/${req.file.filename}` : "";



      console.log("Order ID:", razorpay_order_id);
console.log("Payment ID:", razorpay_payment_id);
console.log("Signature from Razorpay:", razorpay_signature);
console.log("Expected Signature:", expectedSignature);

    const lead = await Lead.create({
      name,
      phone,
      email,
      course,
      advance,
      partnerId: new mongoose.Types.ObjectId(partnerId),
      partnerName,
      proof: proofPath,
      paymentId: razorpay_payment_id,
      orderId: razorpay_order_id,
      paymentStatus: "PAID",
      status: "PENDING",
      remark: "",
    });

    await Partner.findByIdAndUpdate(partnerId, { $inc: { leads: 1 } });

    res.json({ success: true, lead });
  } catch (err) {
    console.error("Add lead error:", err);
    res.status(500).json({ success: false });
  }
});

/* ================= PARTNER LEADS ================= */
router.get("/partner/:id", async (req, res) => {
  const partnerId = new mongoose.Types.ObjectId(req.params.id);

  const leads = await Lead.find({ partnerId }).sort({ createdAt: -1 });
  res.json({ success: true, leads });
});

/* ================= ADMIN ALL LEADS ================= */
router.get("/all", async (req, res) => {
  const leads = await Lead.find().sort({ createdAt: -1 });
  res.json({ success: true, leads });
});

/* ================= DOWNLOAD FILE ================= */
router.get("/download/:filename", (req, res) => {
  const filePath = path.join(__dirname, "..", "uploads", req.params.filename);
  res.download(filePath);
});

/* ================= UPDATE STATUS ================= */
router.put("/update-status/:id", async (req, res) => {
  const updated = await Lead.findByIdAndUpdate(
    req.params.id,
    {
      status: req.body.status, // APPROVED / REJECTED
      remark: req.body.remark,
    },
    { new: true }
  );

  res.json({ success: true, lead: updated });
});

/* ================= DELETE LEAD ================= */
router.delete("/delete/:id", async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) return res.json({ success: false });

  if (lead.proof) {
    const filePath = path.join(__dirname, "..", lead.proof);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  await Lead.findByIdAndDelete(req.params.id);
  res.json({ success: true });
});



/* ================= DASHBOARD STATS ================= */
router.get("/dashboard-stats/:partnerId", async (req, res) => {
  try {
    const partnerId = new mongoose.Types.ObjectId(req.params.partnerId);

    const totalLeads = await Lead.countDocuments({ partnerId });

    const pendingLeads = await Lead.countDocuments({
      partnerId,
      status: "PENDING",
    });

    const contactedLeads = await Lead.countDocuments({
      partnerId,
      status: "CONTACTED",
    });

    const convertedLeads = await Lead.countDocuments({
      partnerId,
      status: "CONVERTED",
    });

    const rejectedLeads = await Lead.countDocuments({
      partnerId,
      status: "REJECTED",
    });

    res.json({
      success: true,
      totalLeads,
      pendingLeads,
      contactedLeads,
      convertedLeads,
      rejectedLeads,
    });
  } catch (err) {
    console.error("Dashboard stats error:", err);
    res.status(500).json({ success: false });
  }
});


/* ===============================
   GET ADVANCE RECORDS (FROM LEADS)
   (NO SEPARATE DB / NO MAPPING ISSUE)
================================ */
router.get("/advance-records", async (req, res) => {
  try {
    const leads = await Lead.find({
      paymentStatus: "PAID",
      advance: { $gt: 0 },
    }).sort({ createdAt: -1 });

    // 🔥 DIRECTLY SEND LEADS DATA
    res.json({
      success: true,
      records: leads,
    });
  } catch (err) {
    console.error("Advance records fetch error:", err);
    res.status(500).json({
      success: false,
      message: "Failed to fetch advance records",
    });
  }
});



module.exports = router;
