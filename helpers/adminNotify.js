// helpers/adminNotify.js
// One-line helper: notifyAdmin({ type, title, message, link })
// Uses the existing createNotification → Notification model → web push hook.
// Never throws, so it can never break the main API request.
const { createNotification } = require("./notificationHelper");

const notifyAdmin = ({
  type = "general",
  title,
  message,
  link = "/admin/notifications",
  dedupeUnread = false,
}) =>
  createNotification({
    recipient_id: null,          // role-wide → every registered admin device
    recipient_role: "admin",
    type,
    title,
    message,
    link,
    dedupeUnread,
  });

module.exports = { notifyAdmin };