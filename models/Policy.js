const mongoose = require("mongoose");

const policyVersionSchema = new mongoose.Schema({
  version_number: { type: Number, required: true },
  file_url: { type: String, required: true },
  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  change_note: { type: String, default: "" },
  created_at: { type: Date, default: Date.now }
});

const policySchema = new mongoose.Schema({
  title: { type: String, required: true },
  category: { 
    type: String, 
    enum: ["HR", "Finance", "IT", "General", "Operations"], 
    required: true 
  },
  description: { type: String, default: "" },
  file_url: { type: String, required: true },
  version: { type: Number, default: 1 },
  is_active: { type: Boolean, default: true },
  applicable_to: { type: String, enum: ["all", "department"], default: "all" },
  department_id: { type: mongoose.Schema.Types.ObjectId, ref: "Department", default: null },
  uploaded_by: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  version_history: [policyVersionSchema]
}, { timestamps: true });

module.exports = mongoose.model("Policy", policySchema);