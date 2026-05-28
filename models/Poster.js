const mongoose = require("mongoose");

const PosterSchema = new mongoose.Schema(
  {
    title:        { type: String, required: true, trim: true },
    imageUrl:     { type: String, required: true },  // /uploads/posters/filename.jpg
    edition:      { type: String, trim: true },       // "May 4th Edition"
    isActive:     { type: Boolean, default: true },
    displayOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Poster", PosterSchema);