// models/Announcement.js
const mongoose = require('mongoose');

// ── Reply (nested comment) ────────────────────────────────────────────────────
const replySchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  name:        { type: String },
  designation: { type: String },
  avatar:      { type: String },
  text:        { type: String, required: true, trim: true },
  likes:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
}, { timestamps: true });

// ── Comment ───────────────────────────────────────────────────────────────────
const commentSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  name:        { type: String },
  designation: { type: String },
  avatar:      { type: String },
  text:        { type: String, required: true, trim: true },
  likes:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  replies:     [replySchema],
}, { timestamps: true });

// ── Announcement ──────────────────────────────────────────────────────────────
const announcementSchema = new mongoose.Schema({
  title:   { type: String, required: true, trim: true },
  content: { type: String, required: true },
  type: {
    type: String,
    enum: ['general', 'urgent', 'event', 'policy', 'achievement', 'holiday'],
    default: 'general'
  },
  priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },

  // Images (base64 or URL)
  images: [{
    url:      { type: String, required: true },
    caption:  { type: String, default: '' },
    filename: { type: String, default: '' }
  }],

  // Targeting
  target:             { type: String, enum: ['all','department','role','individual'], default: 'all' },
  target_departments: [{ type: String }],
  target_roles:       [{ type: String }],
  target_employees:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],

  created_by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  is_active:  { type: Boolean, default: true },
  is_pinned:  { type: Boolean, default: false },
  expires_at: { type: Date },

  // Engagement
  likes:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  comments: [commentSchema],

  // Read tracking
  read_by: [{
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    read_at:     { type: Date, default: Date.now }
  }],

  attachments: [{ name: String, url: String }],
  emoji: { type: String, default: '' }

}, { timestamps: true });

announcementSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.Announcement ||
  mongoose.model('Announcement', announcementSchema);