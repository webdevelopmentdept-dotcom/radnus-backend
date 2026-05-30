const mongoose = require("mongoose");

const PosterSchema = new mongoose.Schema(
  {
    title:        { type: String, required: true, trim: true },
    imageUrl:     { type: String, required: true },
    cloudinary_id: { type: String, default: "" },   // ✅ NEW
    edition:      { type: String, trim: true },
    isActive:     { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
    type: {
      type: String,
      enum: ["jobs", "technicians"],
      default: "jobs",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Poster", PosterSchema);