const mongoose = require("mongoose");

const sopSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },

    department: {
      type: String,
      required: true,
      trim: true,
    },

    // null = Department-level SOP (all roles in dept see this)
    // filled = Designation-level SOP (only that role sees this)
    designation: {
      type: String,
      default: null,
      trim: true,
    },

    // Stored filename after upload (e.g. "1714201234567-Finance-SOP.docx")
    fileUrl: {
      type: String,
      required: true,
    },

    // Original file name shown to employee
    fileName: {
      type: String,
      required: true,
    },

    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("SOP", sopSchema);