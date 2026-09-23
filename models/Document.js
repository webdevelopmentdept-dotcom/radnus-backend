
const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    docType: {
      type: String,
      required: true,
    },
    fileUrl: {
      type: String,
      required: true,
    },
    publicId: {
      type: String,
    },
  },
  { timestamps: true }
);
documentSchema.index({ employeeId: 1, docType: 1 }, { unique: true });

module.exports = mongoose.model("Document", documentSchema);