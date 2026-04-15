const mongoose = require('mongoose');

const wellnessSessionSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  session_type: {
    type: String,
    enum: ['counseling', 'mindful_monday', 'stress_workshop', 'family_support', 'helpline'],
    required: true
  },
  title:       { type: String, required: true },
  description: { type: String },
  scheduled_date: { type: Date, required: true },
  scheduled_time: { type: String },
  mode: {
    type: String,
    enum: ['virtual', 'in_person'],
    default: 'virtual'
  },
  status: {
    type: String,
    enum: ['requested', 'approved', 'rejected', 'completed', 'cancelled'],
    default: 'requested'
  },
  hr_notes:       { type: String },
  employee_notes: { type: String },
  feedback_score: { type: Number, min: 1, max: 10 },
  feedback_comment: { type: String },
  reviewed_by: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee'
  }
}, { timestamps: true });

module.exports = mongoose.model('WellnessSession', wellnessSessionSchema);