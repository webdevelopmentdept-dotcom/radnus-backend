const mongoose = require('mongoose');

const kpiItemSchema = new mongoose.Schema({
  kpi_name:   { type: String, required: true },
  target:     { type: Number, required: true },
  unit:       { type: String, required: true },
  weight:     { type: Number, required: true },
  frequency:  { type: String, enum: ['daily','weekly','monthly','quarterly'], default: 'monthly' },
  owner_role: { type: String, enum: ['self','manager','md','hr'], default: 'self' },

  // ✅ NEW — Admission breakdown
  is_admission_kpi: { type: Boolean, default: false },
  program_targets: [
    {
      program_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Program' },
      program_name: { type: String },
      target:       { type: Number, default: 0 }
    }
  ]
});

const kpiTemplateSchema = new mongoose.Schema({
  template_name: { type: String, required: true },   // "Developer KPI Template"
  role:          { type: String, required: true },   // "Developer"
  department:    { type: String, required: true },   
  description:   { type: String, required: true },  
    is_admission:  { type: Boolean, default: false }, 
  program:       { type: String,  default: "" },   
  kpi_items:     [kpiItemSchema],
  created_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  is_active:     { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('KpiTemplate', kpiTemplateSchema);