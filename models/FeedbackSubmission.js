const mongoose = require('mongoose');
                                                                         
  const feedbackSubmissionSchema = new mongoose.Schema({
    // Which cycle this feedback belongs to
    cycleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'FeedbackCycle',
      required: true,
    },

    // Who is being reviewed
    revieweeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },

    // Who is giving the feedback
    reviewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Employee',
      required: true,
    },

    // Type of reviewer
    reviewerType: {
      type: String,
      enum: ['manager', 'peer', 'subordinate', 'self'],
      required: true,
    },

    // Competency scores (0-100 each)
    competencies: {
      communication: { type: Number, default: 0, min: 0, max: 100 },     
      leadership: { type: Number, default: 0, min: 0, max: 100 },        
      technicalSkills: { type: Number, default: 0, min: 0, max: 100 },   
      goalAchievement: { type: Number, default: 0, min: 0, max: 100 },   
      innovation: { type: Number, default: 0, min: 0, max: 100 },        
      teamwork: { type: Number, default: 0, min: 0, max: 100 },
    },

    // Overall score (0-100) — auto-calculated from competencies
    overallScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    // Text feedback
    strengths: { type: String, default: '' },
    areasForImprovement: { type: String, default: '' },
    additionalComments: { type: String, default: '' },

    // Status
    isSubmitted: { type: Boolean, default: false },
    submittedAt: { type: Date },
  }, { timestamps: true });

  // Pre-save: auto-calculate overall score from competency averages     
  feedbackSubmissionSchema.pre('save', function (next) {
    if (this.isModified('competencies')) {
      const c = this.competencies;
      const scores = [
        c.communication,
        c.leadership,
        c.technicalSkills,
        c.goalAchievement,
        c.innovation,
        c.teamwork,
      ].filter(s => typeof s === 'number' && s > 0);

      if (scores.length > 0) {
        this.overallScore = Math.round(
          scores.reduce((a, b) => a + b, 0) / scores.length
        );
      }
    }
    if (this.isSubmitted && !this.submittedAt) {
      this.submittedAt = new Date();
    }
    next();
  });

  module.exports = mongoose.model('FeedbackSubmission',
  feedbackSubmissionSchema);