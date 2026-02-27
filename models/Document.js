const mongoose = require("mongoose");

const documentSchema = new mongoose.Schema({
 employeeId: {
  type: mongoose.Schema.Types.ObjectId,
  ref: "Employee"
},
  docType: String,
  fileUrl: String
});

module.exports = mongoose.model("Document", documentSchema);