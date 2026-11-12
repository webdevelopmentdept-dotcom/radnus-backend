// models/SchemeSource.js  HR override: which data source to use for one employee in one scheme
const mongoose = require('mongoose');
const SchemeSourceSchema = new mongoose.Schema({
  award_id:    { type: mongoose.Schema.Types.ObjectId, ref: 'AwardDefinition', required: true },
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  source:      { type: String, enum: ['loan_incentive', 'sale_entries', 'daily_log'], required: true },
  set_by_name: { type: String, default: '' },
}, { timestamps: true });
SchemeSourceSchema.index({ award_id: 1, employee_id: 1 }, { unique: true });
module.exports = mongoose.models.SchemeSource || mongoose.model('SchemeSource', SchemeSourceSchema);