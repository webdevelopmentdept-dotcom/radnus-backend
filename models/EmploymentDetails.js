const mongoose = require('mongoose');

const employmentDetailsSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true,
    unique: true
  },
  employment: {
    employee_code: { type: String },
    designation: { type: String },
    department: { type: String },
    employment_type: { type: String, default: 'Full-time' },
    work_location: { type: String },
    work_shift: { type: String, default: 'General Shift' },
    date_of_joining: { type: String },
    probation_period: { type: String },
    confirmation_date: { type: String },
    reporting_manager: { type: String },
  },
  salary: {
    ctc: { type: Number },
    basic: { type: Number },
    hra: { type: Number },
    special_allowance: { type: Number },
    conveyance_allowance: { type: Number },
    gross_salary: { type: Number },
    net_salary: { type: Number },
    professional_tax: { type: Number },
    pf_applicable: { type: Boolean, default: false },
    esi_applicable: { type: Boolean, default: false },
    tds_applicable: { type: Boolean, default: false },
  },
  status: { type: String, enum: ['draft', 'active'], default: 'draft' },
  activated_at: { type: Date },
}, { timestamps: true });

module.exports = mongoose.model('EmploymentDetails', employmentDetailsSchema);