// models/Announcement.js
const mongoose = require('mongoose');

const announcementSchema = new mongoose.Schema({
  title:       { type: String, required: true, trim: true },
  content:     { type: String, required: true },
  type: {
    type: String,
    enum: ['general', 'urgent', 'event', 'policy', 'achievement', 'holiday'],
    default: 'general'
  },
  priority:    { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  // Target audience
  target: {
    type: String,
    enum: ['all', 'department', 'role', 'individual'],
    default: 'all'
  },
  target_departments: [{ type: String }],
  target_roles:       [{ type: String }],
  target_employees:   [{ type: mongoose.Schema.Types.ObjectId, ref: 'Employee' }],
  // Meta
  created_by:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  is_active:   { type: Boolean, default: true },
  is_pinned:   { type: Boolean, default: false },
  expires_at:  { type: Date },
  // Read tracking
  read_by: [{
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    read_at:     { type: Date, default: Date.now }
  }],
  // Attachments (optional links)
  attachments: [{
    name: String,
    url:  String
  }],
  emoji: { type: String, default: '' }
}, { timestamps: true });

// Virtual: read count
announcementSchema.virtual('read_count').get(function () {
  return this.read_by?.length || 0;
});

announcementSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.models.Announcement ||
  mongoose.model('Announcement', announcementSchema);