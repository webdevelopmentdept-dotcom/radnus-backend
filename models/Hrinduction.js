const mongoose = require("mongoose");

const hrInductionSchema = new mongoose.Schema(
  {
    title:       { type: String, required: true, trim: true },
    description: { type: String, default: "", trim: true },

    // Stored filename after upload (e.g. "1714201234567-Welcome-Kit.pdf")
    fileUrl:  { type: String, required: true },
    // Original file name
    fileName: { type: String, required: true },

    status: { type: String, enum: ["active", "inactive"], default: "active" },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.HrInduction || mongoose.model("HrInduction", hrInductionSchema);