// const mongoose = require("mongoose");

// const documentSchema = new mongoose.Schema({
//  employeeId: {
//   type: mongoose.Schema.Types.ObjectId,
//   ref: "Employee"
// },
//   docType: String,
//   fileUrl: String
// });

// module.exports = mongoose.model("Document", documentSchema);

// models/Document.js
// models/Document.js
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

module.exports = mongoose.model("Document", documentSchema);