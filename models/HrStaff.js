const mongoose = require("mongoose");

const hrStaffSchema = new mongoose.Schema(
  {
    name:      { type: String, required: true, trim: true },
    email:     { type: String, required: true, unique: true, lowercase: true, trim: true },
    password:  { type: String, required: true },            // bcrypt hash
    staffRole: { type: String, enum: ["hr", "md", "tester"], default: "hr" },
    status:    { type: String, enum: ["active", "inactive"], default: "active" },
    createdBy: { type: String, default: "" },
    lastLoginAt: { type: Date },

    // link to the real Employee record
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    empCode:    { type: String, default: "" },   // e.g. EMP-037
    department: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.HrStaff || mongoose.model("HrStaff", hrStaffSchema);