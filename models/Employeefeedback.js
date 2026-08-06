// ===== SIMPLE FEEDBACK SYSTEM (standalone — NOT the 360° feedback system) =====

const mongoose = require('mongoose');

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeedbackQuestion' },
    questionText: { type: String, required: true },
    type: { type: String, enum: ['text', 'single_choice'], required: true },
    options: { type: [String], default: [] }, // snapshot, for reference only

    // For type 'text' -> the free text answer
    // For type 'single_choice' -> the one option the employee picked
    answer: { type: String, default: '' },

    // Optional comment (only relevant if the question had hasComment: true)
    comment: { type: String, default: '' },
  },
  { _id: false }
);

const employeeFeedbackSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },

    // Header details — snapshotted at submit time (same reasoning as
    // answers above: HR should see what was true when the employee submitted,
    // even if the employee's profile changes later).
    employeeName: { type: String, default: '' },
    employeeCode: { type: String, default: '' }, // Employee ID (employeeId field on Employee)
    department: { type: String, default: '' },
    designation: { type: String, default: '' },

    // If true, HR sees "Anonymous" instead of the name/code above
    anonymous: { type: Boolean, default: false },

    answers: { type: [answerSchema], default: [] },

    // Optional attachment (screenshot/proof)
    attachmentUrl: { type: String, default: '' },

    status: {
      type: String,
      enum: ['Pending', 'Reviewed'],
      default: 'Pending',
    },

    // HR's reply note (e.g. "ok", "noted, will discuss in next meeting")
    hrReply: { type: String, default: '' },
    reviewedAt: { type: Date },
  },
  { timestamps: true } // createdAt = submission date
);

module.exports = mongoose.model('EmployeeFeedback', employeeFeedbackSchema);