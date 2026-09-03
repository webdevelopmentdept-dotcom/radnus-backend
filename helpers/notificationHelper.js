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
    // ✅ Duplicate guard — if the exact same notification (same recipient,
    // title, message) was already created in the last 10 seconds, skip it.
    const tenSecondsAgo = new Date(Date.now() - 10_000);
    const dupe = await Notification.findOne({
      recipient_id,
      recipient_role,
      title,
      message,
      createdAt: { $gte: tenSecondsAgo }
    });
    if (dupe) return dupe;

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