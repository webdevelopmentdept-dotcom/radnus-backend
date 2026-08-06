// ===== SIMPLE FEEDBACK SYSTEM (standalone — NOT the 360° feedback system) =====

const mongoose = require('mongoose');

const feedbackQuestionSchema = new mongoose.Schema(
  {
    // The question text shown to the employee
    questionText: { type: String, required: true, trim: true },

    // 'text'          -> open-ended textarea (e.g. "Suggestions for Improvement")
    // 'single_choice' -> pick ONE option (radio/dropdown, e.g. Excellent/Good/Average)
    type: {
      type: String,
      enum: ['text', 'single_choice'],
      required: true,
      default: 'text',
    },

    // Only used when type === 'single_choice'
    options: {
      type: [String],
      default: [],
    },

    // Optional extra text box shown along with a single_choice answer
    // e.g. Q2-Q4/Q6/Q7 -> "Comments:", Q5 -> "If No, please specify:", Q10 -> "Reason:"
    hasComment: { type: Boolean, default: false },
    commentLabel: { type: String, default: 'Comments' },

    required: { type: Boolean, default: true },

    // Controls display order on the employee form
    order: { type: Number, default: 0 },

    // HR can deactivate a question instead of deleting it (keeps old
    // submissions' answers meaningful). Delete is still allowed if HR wants.
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('FeedbackQuestion', feedbackQuestionSchema);