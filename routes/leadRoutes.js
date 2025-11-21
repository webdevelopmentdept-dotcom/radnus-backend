const express = require("express");
const router = express.Router();
const multer = require("multer");
const Lead = require("../models/Lead");
const Partner = require("../models/partner");
const path = require("path");

// Upload folder public
router.use("/uploads", express.static(path.join(__dirname, "../uploads")));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  }
});

const upload = multer({ storage });

// ADD LEAD
router.post("/add", upload.single("proof"), async (req, res) => {
  try {
    const filePath = req.file ? "/uploads/" + req.file.filename : null;

    const lead = new Lead({
      name: req.body.name,
      phone: req.body.phone,
      email: req.body.email,
      course: req.body.course,
      advance: req.body.advance,
      notes: req.body.notes,
      proof: filePath,
      partnerId: req.body.partnerId,
    });

    await lead.save();

    // 🔥🔥 UPDATE PARTNER LEAD COUNT 🔥🔥
    await Partner.findByIdAndUpdate(req.body.partnerId, {
      $inc: { leads: 1 }
    });

    return res.json({ success: true, message: "Lead added!" });

  } catch (err) {
    console.error("Lead error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


// ADMIN – GET ALL LEADS
router.get("/all", async (req, res) => {
  try {
    const leads = await Lead.find().populate("partnerId");
    res.json(leads);
  } catch (err) {
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// UPDATE STATUS
router.put("/update-status/:id", async (req, res) => {
  try {
    await Lead.findByIdAndUpdate(req.params.id, {
      status: req.body.status,
      remark: req.body.remark,
    });

    res.json({ success: true, message: "Lead updated!" });

  } catch (err) {
    res.status(500).json({ success: false, message: "Error updating lead" });
  }
});
// ==========================
// GET LEADS OF ONE PARTNER
// ==========================
router.get("/partner/:partnerId", async (req, res) => {
  try {
    const { partnerId } = req.params;

    const leads = await Lead.find({ partnerId }).sort({ date: -1 });

    return res.json({ success: true, leads });
  } catch (err) {
    console.log("Partner leads error:", err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});


module.exports = router;
