const express = require("express");
const router  = express.Router();
const multer  = require("multer");
const QRCode  = require("qrcode"); // npm install qrcode
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const Product = require("../models/Product");
const Counter = require("../models/Counter");
const { getOrCreateSharedEquipmentProgram } = require("../controllers/trainingrcaController");
const auth = require("../middleware/auth");
const canManageProducts = require("../middleware/canManageProducts");

// ── Cloudinary storage — same pattern as routes/Posterroutes.js ──────────────
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "radnus-connect/products",
    resource_type: "image",
    public_id: `product_${Date.now()}_${Math.round(Math.random() * 1e5)}`,
    transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB per image — keeps total request size under hosting-platform proxy limits (was 20MB, caused 413 Content Too Large)
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only image files are allowed"));
  },
});

// ── Auto product code generator — same pattern as routes/employeeAuth.js ────
// e.g. RAD-MSE-001, RAD-TLS-002 ... prefix depends on category
const CATEGORY_PREFIX = {
  "Mobile Service Equipment": "MSE",
  "Tools": "TLS",
  "Machinery": "MCH",
  "Accessories": "ACC",
  "Software / Tools": "SFT",
};

const generateProductCode = async (category) => {
  const prefix = CATEGORY_PREFIX[category] || "GEN";
  const counter = await Counter.findOneAndUpdate(
    { name: `product_${prefix}` },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return { code: `RAD-${prefix}-${String(counter.seq).padStart(3, "0")}`, prefix };
};

// If product creation fails AFTER a code number was reserved, give the
// number back — otherwise every failed save (validation error, Cloudinary
// hiccup, etc.) permanently burns a number and codes end up with gaps
// instead of running 001, 002, 003...
const rollbackProductCode = async (prefix) => {
  await Counter.findOneAndUpdate({ name: `product_${prefix}` }, { $inc: { seq: -1 } }).catch(() => {});
};

// ══════════════════════════════════════════════════════
//  HR / ADMIN ROUTES
// ══════════════════════════════════════════════════════

// ── GET /api/products — list all (filters: category, status, skillLevel) ────
router.get("/", auth, canManageProducts, async (req, res) => {
  try {
    const { category, status, skillLevel } = req.query;
    const filter = {};
    if (category)   filter.category   = category;
    if (status)      filter.status     = status;
    if (skillLevel)  filter.skillLevel = skillLevel;

    const products = await Product.find(filter)
      .populate("sopId")
      .populate("trainingProgramId")
      .populate("relatedProducts", "productName productCode category")
      // updatedBy is now a plain string (HR login id), not populatable
      .sort({ createdAt: -1 });

    res.json({ success: true, data: products, total: products.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/products/:id — single product card ──────────────────────────────
router.get("/:id", auth, canManageProducts, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate("sopId")
      .populate("trainingProgramId")
      .populate("relatedProducts", "productName productCode category");
      // updatedBy is now a plain string (HR login id), not populatable

    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/products — create product card (images[] upload) ──────────────
router.post("/", auth, canManageProducts, upload.array("images", 6), async (req, res) => {
let reservedPrefix = null;
  try {
    const {
      productName, category, specification, applications,
      operatingProcedure, safetyInstructions, skillLevel, trainingVideoUrl,
      sopId, trainingProgramId, troubleshooting, maintenanceSchedule,
      relatedProducts, trainerNotes, updatedBy,
    } = req.body;

    if (!productName || !category) {
      return res.status(400).json({ success: false, message: "Product name and category are required" });
    }

    const { code: productCode, prefix } = await generateProductCode(category);
    reservedPrefix = prefix; // now that a number is reserved, roll it back if anything below fails

    const images = (req.files || []).map((f) => ({
      url: f.path,          // https://res.cloudinary.com/...
      cloudinary_id: f.filename,
    }));

    const product = await Product.create({
      productName: productName.trim(),
      productCode,
      category,
      images,
      // Sent as a JSON string via multipart/form-data — parse defensively
      specification: specification ? JSON.parse(specification) : undefined,
      applications,
      operatingProcedure,
      safetyInstructions,
      skillLevel,
      trainingVideoUrl,
      sopId: sopId || null,
      trainingProgramId: trainingProgramId || null,
      // JSON strings if sent via multipart/form-data — parse defensively
      troubleshooting: troubleshooting ? JSON.parse(troubleshooting) : [],
      maintenanceSchedule: maintenanceSchedule ? JSON.parse(maintenanceSchedule) : [],
      relatedProducts: relatedProducts ? JSON.parse(relatedProducts) : [],
      trainerNotes,
      updatedBy: updatedBy || null,
    });
    reservedPrefix = null; // product now exists with this code — nothing left to roll back

    // Generate QR pointing to the product's public page, store as a data URL
    const productUrl = `https://radnus.in/product/${product.productCode}`;
    product.qrCodeUrl = await QRCode.toDataURL(productUrl);

    // Auto-link to the single shared "Equipment Training" program — HR
    // doesn't have to create anything separately, and it's already wired
    // to the existing assign/track/compliance flow in trainingrcaController.js.
    // Skip if the request explicitly points to an existing program instead.
    if (!product.trainingProgramId) {
      const sharedProgram = await getOrCreateSharedEquipmentProgram();
      product.trainingProgramId = sharedProgram._id;
    }

    await product.save();

    res.status(201).json({ success: true, data: product, message: "Product created successfully" });
  } catch (err) {
    // Only the reservation (not an actual saved product) needs undoing —
    // once Product.create() succeeds above, reservedPrefix is cleared so a
    // later failure (QR/training-program step) won't double-free the number.
    if (reservedPrefix) await rollbackProductCode(reservedPrefix);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/products/:id — update (new images optional, appended) ───────────
router.put("/:id", auth, canManageProducts, upload.array("images", 6), async (req, res) => {
try {
    const existing = await Product.findById(req.params.id);
    if (!existing) return res.status(404).json({ success: false, message: "Product not found" });

    const updateData = { ...req.body, updatedBy: req.body.updatedBy || existing.updatedBy };

    // Empty string can't be cast to ObjectId by Mongoose — must be null instead.
    // Without this, saving a product with no SOP selected throws a CastError (500).
    if (updateData.sopId === "") updateData.sopId = null;
    if (updateData.trainingProgramId === "") updateData.trainingProgramId = null;

    ["troubleshooting", "maintenanceSchedule", "relatedProducts", "specification"].forEach((f) => {
      if (typeof updateData[f] === "string") updateData[f] = JSON.parse(updateData[f]);
    });

    // removeImages = JSON array of cloudinary_id for existing images the user
    // removed in the edit form. Delete from Cloudinary + drop from the array
    // BEFORE appending any newly-uploaded ones below.
    let keptImages = existing.images;
    if (typeof updateData.removeImages === "string") {
      const removeIds = JSON.parse(updateData.removeImages);
      if (removeIds.length) {
        keptImages = existing.images.filter((img) => !removeIds.includes(img.cloudinary_id));
        for (const id of removeIds) {
          await cloudinary.uploader.destroy(id).catch(() => {});
        }
      }
    }
    delete updateData.removeImages; // not a Product schema field

    if (req.files?.length) {
      const newImages = req.files.map((f) => ({ url: f.path, cloudinary_id: f.filename }));
      updateData.images = [...keptImages, ...newImages];
    } else {
      updateData.images = keptImages;
    }

    const product = await Product.findByIdAndUpdate(req.params.id, updateData, { new: true });
    res.json({ success: true, data: product, message: "Product updated successfully" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /api/products/:id/status — toggle active/inactive ──────────────────
router.patch("/:id/status", auth, canManageProducts, async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "inactive"].includes(status)) {
      return res.status(400).json({ success: false, message: "Invalid status" });
    }
    const product = await Product.findByIdAndUpdate(req.params.id, { status }, { new: true });
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, data: product, message: `Product marked ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// If the product being deleted was the LAST one created for its category
// (its seq number matches the counter's current value), give that number
// back — same idea as rollbackProductCode() on a failed create. Only safe
// when it's the most-recent number; freeing a number in the middle of the
// sequence would risk a future create colliding with a still-existing
// product's code (productCode is unique), so those gaps are left as-is.
const reclaimProductCodeIfLatest = async (productCode) => {
  const match = /^RAD-([A-Z]+)-(\d+)$/.exec(productCode || "");
  if (!match) return;
  const [, prefix, seqStr] = match;
  const seq = Number(seqStr);

  const counter = await Counter.findOne({ name: `product_${prefix}` });
  if (!counter || counter.seq !== seq) return; // not the latest — leave the gap

  await Counter.findOneAndUpdate(
    { name: `product_${prefix}`, seq }, // only decrement if still unchanged (avoids races)
    { $inc: { seq: -1 } }
  ).catch(() => {});
};

// ── DELETE /api/products/:id — remove product + its Cloudinary images ────────
router.delete("/:id", auth, canManageProducts, async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    for (const img of product.images) {
      if (img.cloudinary_id) {
        await cloudinary.uploader.destroy(img.cloudinary_id).catch(() => {});
      }
    }

    await Product.findByIdAndDelete(req.params.id);
    await reclaimProductCodeIfLatest(product.productCode);

    res.json({ success: true, message: "Product deleted permanently" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  EMPLOYEE ROUTE — QR scan / product page view
// ══════════════════════════════════════════════════════

// ── GET /api/products/code/:productCode — QR scan lands here ─────────────────
router.get("/code/:productCode", async (req, res) => {
  try {
    const product = await Product.findOne({ productCode: req.params.productCode, status: "active" })
      .populate("sopId")
      .populate("trainingProgramId");

    if (!product) return res.status(404).json({ success: false, message: "Product not found" });
    res.json({ success: true, data: product });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Router-level error handler ────────────────────────────────────────────
// Catches errors thrown by middleware BEFORE they reach a route handler's
// own try/catch — most importantly multer/Cloudinary upload errors (bad
// credentials, quota exceeded, invalid file, network issues to Cloudinary).
// Without this, such errors fell through to Express's default HTML error
// page instead of JSON, and the frontend could only show a generic
// "status 500" message with no indication of the real cause.
// Must be declared with 4 params and placed AFTER all routes above for
// Express to treat it as error-handling middleware.
router.use((err, req, res, next) => {
  console.error("PRODUCT ROUTE ERROR:", err);
  res.status(500).json({
    success: false,
    message: err.message || "Something went wrong while processing the product request",
  });
});

module.exports = router;