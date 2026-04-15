const mongoose = require('mongoose');

const kpiItemSchema = new mongoose.Schema({
  kpi_name: { type: String, required: true },      // "Tasks Completed"
  target: { type: Number, required: true },         // 20
  unit: { type: String, required: true },           // "tasks", "₹", "%"
  weight: { type: Number, required: true },         // 40 (means 40%)
  frequency: { 
    type: String, 
    enum: ['daily', 'weekly', 'monthly', 'quarterly'], 
    default: 'monthly' 
  }
});

const kpiTemplateSchema = new mongoose.Schema({
  template_name: { type: String, required: true },  // "Developer KPI Template"
  role: { type: String, required: true },            // "Developer"
  department: { type: String, required: true },      // "IT"
  description: { type: String },                     
  kpi_items: [kpiItemSchema],                        // array of KPIs
  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  is_active: { type: Boolean, default: true }
}, { timestamps: true });

module.exports = mongoose.model('KpiTemplate', kpiTemplateSchema);