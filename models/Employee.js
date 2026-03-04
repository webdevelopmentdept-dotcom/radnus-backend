const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, unique: true },

  name: String,
  email: { type: String, unique: true },
  password: String,
 

mobile: {
  type: String,
  unique: true
}

,
  department: String,
  designation: String,

  documentsCompleted: {
    type: Boolean,
    default: false
  },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },

  remarks: {
    type: String,
    default: ""
  },

  reuploaded: {
  type: Boolean,
  default: false
}

}, {
  timestamps: true   // 🔥 THIS LINE IMPORTANT
});

module.exports = mongoose.model("Employee", employeeSchema);