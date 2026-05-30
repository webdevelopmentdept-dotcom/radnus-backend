const express = require("express");
const router  = express.Router();
const Poster  = require("../models/Poster");
const multer  = require("multer");
const { CloudinaryStorage } = require("multer-storage-cloudinary");
const cloudinary = require("../config/cloudinary");

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "radnus-connect/posters",
    resource_type: "image",
    public_id: `poster_${Date.now()}`,
    transformation: [{ width: 1200, crop: "limit", quality: "auto" }],
  }),
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith("image/")) cb(null, true);
    else cb(new Error("Only images allowed"));
  },
});

router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.type) filter.type = req.query.type;
    const posters = await Poster.find(filter).sort({ displayOrder: 1, createdAt: -1 });
    res.json(posters);
  } catch {
    res.status(500).json({ success: false });
  }
});

router.post("/", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: "Image required" });


    const poster = new Poster({
      title:         req.body.title || "Hiring Poster",
      edition:       req.body.edition || "",
      imageUrl:      req.file.path,       // https://res.cloudinary.com/...
      cloudinary_id: req.file.filename,   // radnus-connect/posters/poster_xxx
      displayOrder:  Number(req.body.displayOrder) || 0,
      type:          req.body.type || "jobs",
    });

    await poster.save();
    res.status(201).json({ success: true, poster });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const updated = await Poster.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json({ success: true, poster: updated });
  } catch {
    res.status(500).json({ success: false });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const poster = await Poster.findById(req.params.id);
    if (!poster) return res.status(404).json({ success: false });

    if (poster.cloudinary_id) {
      await cloudinary.uploader.destroy(poster.cloudinary_id, {
        resource_type: "image",
      });
    }

    await Poster.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;