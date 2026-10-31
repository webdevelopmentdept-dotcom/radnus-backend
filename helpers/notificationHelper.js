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
  link = "",
  dedupeUnread = false, // true → same notification still UNREAD irundha, puthusa create pannaadhu
}) => {
  try {
    // Duplicate guard
    //  - default: last 10 seconds-la same notification irundha skip
    //  - dedupeUnread: true → time limit illa, innum unread-ah irundha skip
    const query = { recipient_id, recipient_role, title, message };
    if (dedupeUnread) {
      query.isRead = false;
    } else {
      query.createdAt = { $gte: new Date(Date.now() - 10_000) };
    }

    const dupe = await Notification.findOne(query);
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