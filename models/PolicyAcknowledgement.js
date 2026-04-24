const mongoose = require("mongoose");

const policyAcknowledgementSchema = new mongoose.Schema({
  policy_id: { type: mongoose.Schema.Types.ObjectId, ref: "Policy", required: true },
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  version_number: { type: Number, required: true },
  acknowledged_at: { type: Date, default: Date.now },
  is_current: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model("PolicyAcknowledgement", policyAcknowledgementSchema);