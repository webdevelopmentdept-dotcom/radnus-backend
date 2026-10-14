// services/pushService.js
// Sends browser (Web Push) notifications — works even when the site tab/browser window is closed.
const webpush = require("web-push");
const PushSubscription = require("../models/PushSubscription");

const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT } = process.env;

const pushEnabled = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY);

if (pushEnabled) {
  webpush.setVapidDetails(
    VAPID_SUBJECT || "mailto:hr@radnus.in",
    VAPID_PUBLIC_KEY,
    VAPID_PRIVATE_KEY
  );
} else {
  console.warn("⚠️  Web Push disabled: VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY missing in .env");
}

const DEFAULT_LINK = {
  employee: "/employee/notifications",
  hr: "/hr/dashboard/notifications",
  admin: "/admin",
};

/**
 * Push one Notification document to every device registered for its recipient.
 *  - recipient_id present                  -> only that user's devices
 *  - HR notification without recipient_id  -> every HR device (role-wide)
 * Never throws: a push failure must never break the main API request.
 */
async function sendPushForNotification(notif) {
  if (!pushEnabled || !notif || notif.isRead) return;

  try {
    const query = { recipient_role: notif.recipient_role };
    if (notif.recipient_id) query.recipient_id = String(notif.recipient_id);

    const found = await PushSubscription.find(query).lean();

    // one browser may be registered twice (e.g. two HR ids) -> send only once per endpoint
    const subs = [...new Map(found.map((s) => [s.endpoint, s])).values()];
    if (!subs.length) return;

    const payload = JSON.stringify({
      id: String(notif._id),
      title: notif.title,
      body: notif.message,
      url: notif.link || DEFAULT_LINK[notif.recipient_role] || "/",
      type: notif.type,
    });

    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: s.keys },
            payload,
            { TTL: 60 * 60 * 24 } // keep up to 24h if the device is offline
          );
        } catch (err) {
          // 404/410 = subscription expired or user revoked permission -> clean up
          if (err.statusCode === 404 || err.statusCode === 410) {
            await PushSubscription.deleteMany({ endpoint: s.endpoint });
          } else {
            console.error("Push send error:", err.statusCode, err.body || err.message);
          }
        }
      })
    );
  } catch (err) {
    console.error("sendPushForNotification error:", err.message);
  }
}

module.exports = { sendPushForNotification, pushEnabled, VAPID_PUBLIC_KEY };