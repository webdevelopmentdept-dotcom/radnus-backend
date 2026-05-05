const mongoose = require('mongoose');

const kpiItemSchema = new mongoose.Schema({
  kpi_name:  { type: String, required: true },       // "Tasks Completed"
  target:    { type: Number, required: true },        // 20
  unit:      { type: String, required: true },        // "tasks", "count", "value", "₹", "%"
  weight:    { type: Number, required: true },        // 40 (means 40%)
  frequency: {
    type: String,
    enum: ['daily', 'weekly', 'monthly', 'quarterly'],
    default: 'monthly'
  },
  // ✅ NEW: who fills actual value for this KPI item
  owner_role: {
    type: String,
    enum: ['self', 'manager', 'md', 'hr'],
    default: 'self'
    // self    = employee fills their own
    // manager = direct manager fills
    // md      = MD / Director fills (e.g. discipline KPI)
    // hr      = HR fills (e.g. attendance-based KPI)
  }
});

const kpiTemplateSchema = new mongoose.Schema({
  template_name: { type: String, required: true },   // "Developer KPI Template"
  role:          { type: String, required: true },   // "Developer"
  department:    { type: String, required: true },   // "IT"
  description:   { type: String, required: true },   // ✅ Now required
  kpi_items:     [kpiItemSchema],
  created_by:    { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  is_active:     { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('KpiTemplate', kpiTemplateSchema);