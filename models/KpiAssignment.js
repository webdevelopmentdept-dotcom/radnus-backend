const mongoose = require('mongoose');

const kpiAssignmentSchema = new mongoose.Schema({
  employee_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Employee', 
    required: true 
  },
  template_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'KpiTemplate', 
    required: true 
  },
  period: { 
    type: String, 
    required: true   // e.g. "March 2026", "Q1 2026"
  },
  period_type: { 
    type: String, 
    enum: ['monthly', 'quarterly', 'annual'], 
    default: 'monthly' 
  },
  status: { 
    type: String, 
    enum: ['active', 'completed', 'cancelled'], 
    default: 'active' 
  },
  assigned_by: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'HR' 
  },
  notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('KpiAssignment', kpiAssignmentSchema);