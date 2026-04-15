const mongoose = require('mongoose');

const variablePaySchema = new mongoose.Schema({
  employee_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Employee', 
    required: true 
  },
  assignment_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'KpiAssignment' 
  },
  period: { type: String, required: true },
  
  // Employee category
  employee_category: { 
    type: String, 
    enum: ['exec', 'mgr', 'sr', 'vp'], 
    required: true 
  },
  
  // CTC & Variable %
  annual_ctc: { type: Number, required: true },
  variable_pct: { type: Number, required: true },
  
  // Performance scores (from policy 3.24)
  okr_score: { type: Number, default: 0 },      // 40% weight
  kpi_score: { type: Number, default: 0 },      // 30% weight
  feedback_score: { type: Number, default: 0 }, // 20% weight
  innovation_score: { type: Number, default: 0 },// 10% weight
  
  // Calculated
  performance_score: { type: Number, default: 0 },
  variable_pay_amount: { type: Number, default: 0 },
  
  status: { 
    type: String, 
    enum: ['draft', 'approved', 'paid'], 
    default: 'draft' 
  },
  calculated_by: { type: mongoose.Schema.Types.ObjectId, ref: 'HR' },
  approved_by: { type: mongoose.Schema.Types.ObjectId, ref: 'HR' },
  notes: { type: String }
}, { timestamps: true });

module.exports = mongoose.model('VariablePay', variablePaySchema);