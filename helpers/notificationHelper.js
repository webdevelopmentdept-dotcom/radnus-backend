// ── notificationHelper.js ──
// Place this in: helpers/notificationHelper.js
// Import in any route: const { createNotification } = require("../helpers/notificationHelper");

const Notification = require("../models/Notification");

const createNotification = async ({
  recipient_id,
  recipient_role, // "employee" or "hr"
  type,
  title,
  message,
  link = ""
}) => {
  try {
    await Notification.create({
      recipient_id,
      recipient_role,
      type,
      title,
      message,
      link,
      isRead: false
    });
  } catch (err) {
    console.error("Notification error:", err.message);
  }
};

module.exports = { createNotification };