const mongoose = require('mongoose');

const esopSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee', required: true
  },
  grade: { type: String, required: true }, // L6–L10
  designation: { type: String },

  // Grant details
  grant_date: { type: Date, default: Date.now },
  total_options: { type: Number, required: true },
  allocation_pct: { type: Number, required: true }, // e.g. 0.10
  exercise_price: { type: Number, required: true },  // ₹ per share
  company_valuation: { type: Number },               // ₹ crore

  // Vesting
  vesting_start: { type: Date },
  vesting_schedule: {
    year1: { type: Number, default: 0 },   // %
    year2: { type: Number, default: 25 },
    year3: { type: Number, default: 25 },
    year4: { type: Number, default: 25 },
    year5: { type: Number, default: 25 },
  },

  // Status
  status: {
    type: String,
    enum: ['granted', 'vesting', 'vested', 'exercised', 'forfeited'],
    default: 'granted'
  },

  // Exercise
  exercised_options: { type: Number, default: 0 },
  exercised_at: { type: Date },
  payout_method: {
    type: String,
    enum: ['shares', 'cash_equivalent'],
    default: 'shares'
  },

  approved_by: { type: String },
  notes: { type: String },
}, { timestamps: true });

module.exports = mongoose.model('Esop', esopSchema);