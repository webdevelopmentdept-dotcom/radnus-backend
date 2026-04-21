// models/IncentiveAssignment.js
const mongoose = require("mongoose");

const IncentiveAssignmentSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee",      required: true },
  plan_id:     { type: mongoose.Schema.Types.ObjectId, ref: "IncentivePlan", required: true },
  cycle:       { type: String, enum: ["Monthly","Quarterly","Half-Yearly","Yearly"], default: "Monthly" },
  period:      { type: String, required: true }, // e.g. "2026-04" or "2026-Q2"
}, { timestamps: true });

IncentiveAssignmentSchema.index({ employee_id: 1, period: 1 }, { unique: true });

module.exports = mongoose.model("IncentiveAssignment", IncentiveAssignmentSchema);