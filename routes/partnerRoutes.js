const express = require("express");
const multer = require("multer");
const bcrypt = require("bcryptjs");
const Partner = require("../models/Partner");
const Lead = require("../models/Lead");
const path = require("path");

const router = express.Router();

/* ----------------------------------------------
   MULTER STORAGE
------------------------------------------------ */
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, "../uploads"));
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + "-" + file.originalname);
  },
});

const upload = multer({ storage });

/* ----------------------------------------------
   ADD NEW PARTNER (ADMIN)
------------------------------------------------ */
router.post("/add", upload.single("document"), async (req, res) => {
  try {
    const { name, email, phone, address, password } = req.body;

    const exists = await Partner.findOne({ email });
    if (exists) {
      return res.json({ success: false, message: "Email already exists" });
    }

    const hashPass = await bcrypt.hash(password, 10);

    const partner = new Partner({
      name,
      email,
      phone,
      address,
      password: hashPass,
      document: req.file ? req.file.filename : "",
    });

    await partner.save();

    return res.json({ success: true, message: "Partner created successfully" });
  } catch (err) {
    console.log(err);
    return res.status(500).json({ success: false, message: "Server error" });
  }
});

/* ----------------------------------------------
   CHANNEL PARTNER LOGIN  ✔ FIXED VERSION
------------------------------------------------ */
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email & password required",
      });
    }

    const partner = await Partner.findOne({ email });
    if (!partner) {
      return res.status(400).json({
        success: false,
        message: "Invalid email",
      });
    }

    const isMatch = await bcrypt.compare(password, partner.password);
    if (!isMatch) {
      return res.status(400).json({
        success: false,
        message: "Incorrect password",
      });
    }

    if (partner.disabled === true) {
      return res.status(403).json({
        success: false,
        message: "Your account is disabled",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Login successful",
      partnerId: partner._id,
      name: partner.name,
    });

  } catch (err) {
    console.log("Login error:", err);
    return res.status(500).json({
      success: false,
      message: "Server error",
    });
  }
});


/* ----------------------------------------------
   UPDATE PARTNER
------------------------------------------------ */
router.put("/update/:id", upload.single("document"), async (req, res) => {
  try {
    const id = req.params.id;
    const { name, email, phone, address } = req.body;

    const updateData = { name, email, phone, address };
    if (req.file) updateData.document = req.file.filename;

    const updated = await Partner.findByIdAndUpdate(id, updateData, {
      new: true,
    });

    return res.json({ success: true, partner: updated });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Update failed" });
  }
});

/* ----------------------------------------------
   DELETE PARTNER
------------------------------------------------ */
router.delete("/delete/:id", async (req, res) => {
  try {
    await Partner.findByIdAndDelete(req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ success: false });
  }
});

/* ----------------------------------------------
   ENABLE / DISABLE PARTNER
------------------------------------------------ */
router.put("/toggle/:id", async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id);
    if (!partner) return res.json({ success: false });

    partner.disabled = !partner.disabled;
    await partner.save();

    return res.json({ success: true });
  } catch (err) {
    return res.json({ success: false });
  }
});

/* -----------------------------------------------------
   ✔ GET ALL PARTNERS WITH LIVE LEADS COUNT
------------------------------------------------------ */
router.get("/all", async (req, res) => {
  try {
    const partners = await Partner.find().sort({ _id: -1 });

    const finalList = await Promise.all(
      partners.map(async (p) => {
        const count = await Lead.countDocuments({ partnerId: p._id });
        return { ...p._doc, leadsCount: count };
      })
    );

    res.json(finalList);
  } catch (err) {
    console.log("Partner fetch error:", err);
    res.status(500).json({ success: false });
  }
});


/* ----------------------------------------------
   GET SINGLE PARTNER BY ID  ✅
------------------------------------------------ */
router.get("/:id", async (req, res) => {
  try {
    const partner = await Partner.findById(req.params.id).select("-password");

    if (!partner) {
      return res.json({ success: false, message: "Partner not found" });
    }

    res.json({ success: true, partner });
  } catch (err) {
    console.log("Get partner error:", err);
    res.status(500).json({ success: false });
  }
});


/* ----------------------------------------------
   DOWNLOAD DOCUMENT
------------------------------------------------ */
router.get("/download/:filename", (req, res) => {
  const fileName = decodeURIComponent(req.params.filename);
  const filePath = path.join(__dirname, "../uploads", fileName);

  res.download(filePath, (err) => {
    if (err) {
      return res.status(404).send("File not found");
    }
  });
});



module.exports = router;
