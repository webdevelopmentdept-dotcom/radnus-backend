const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema({
  recipient_id:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: false },
  recipient_role: { type: String, enum: ["employee", "hr"], required: true },

  // ✅ Types matching your existing frontend TYPE_META
  type: {
    type: String,
    enum: [
      // HR types
      "leave", "employee", "document", "system",
      // Employee types  
      "hr", "attendance", "salary", "announcement",
      // Common
      "general", "kpi_assigned", "review_done",
      "leave_approved", "leave_rejected",
      "employee_activated", "new_applicant"
    ],
    default: "general"
  },

  title:   { type: String, required: true },
  message: { type: String, required: true },
  link:    { type: String, default: "" },
  isRead:  { type: Boolean, default: false },  // ✅ isRead (not read) — matches frontend

}, { timestamps: true });

notificationSchema.index({ recipient_id: 1, isRead: 1 });

module.exports = mongoose.model("Notification", notificationSchema);