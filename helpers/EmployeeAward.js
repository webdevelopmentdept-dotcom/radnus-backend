const mongoose = require('mongoose');

const employeeAwardSchema = new mongoose.Schema({
  award_type: {
    type: String,
    enum: ['spot', 'monthly_star', 'innovation'],
    required: true
  },

  // Nominee
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },

  // Nominator
  nominated_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  },
  nomination_source: { type: String }, // "self", "dept_head", "manager", "peer"

  // Details
  period: { type: String },        // e.g. "March 2026", "Q1 2026"
  reason: { type: String, required: true },
  achievement_details: { type: String },

  // Award
  cash_amount: { type: Number, default: 0 },
  certificate_issued: { type: Boolean, default: false },
  gift_voucher: { type: Boolean, default: false },

  // Status flow
  status: {
    type: String,
    enum: ['nominated', 'dept_validated', 'hr_approved', 'announced', 'rejected'],
    default: 'nominated'
  },

  // Evaluation
  dept_head_comment: { type: String },
  hr_comment: { type: String },
  evaluation_panel: { type: String }, // for innovation awards

  // Recognition
  wall_of_fame: { type: Boolean, default: false },
  announced_at: { type: Date },

}, { timestamps: true });

module.exports = mongoose.model('EmployeeAward', employeeAwardSchema);