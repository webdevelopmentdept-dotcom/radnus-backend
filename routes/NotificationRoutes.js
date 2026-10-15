const express      = require("express");
const router       = express.Router();
const Notification = require("../models/Notification");
const Employee = require("../models/Employee");



// ══════════════════════════════════════════
// ✅ WEB PUSH — must stay ABOVE the "/:recipientId" routes
// ══════════════════════════════════════════
const PushSubscription = require("../models/PushSubscription");
const { VAPID_PUBLIC_KEY, pushEnabled } = require("../services/pushService");

// GET /api/notifications/push/public-key
router.get("/push/public-key", (req, res) => {
  if (!pushEnabled) return res.status(503).json({ success: false, message: "Push not configured" });
  res.json({ success: true, publicKey: VAPID_PUBLIC_KEY });
});

// POST /api/notifications/push/subscribe
// Body: { subscription, recipient_id, recipient_role }
router.post("/push/subscribe", async (req, res) => {
  try {
    const { subscription, recipient_id, recipient_role } = req.body;
    if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
      return res.status(400).json({ success: false, message: "Invalid subscription" });
    }
    if (!recipient_id || !["employee", "hr", "admin"].includes(recipient_role)) {
      return res.status(400).json({ success: false, message: "recipient_id & recipient_role required" });
    }

    // same browser + same identity = one record (a browser can hold an HR AND an employee identity)
    await PushSubscription.findOneAndUpdate(
      { endpoint: subscription.endpoint, recipient_id: String(recipient_id), recipient_role },
      {
        keys: subscription.keys,
        userAgent: req.headers["user-agent"] || "",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/notifications/push/unsubscribe
// Body: { endpoint, recipient_id, recipient_role } — removes ONLY that identity on that device
router.post("/push/unsubscribe", async (req, res) => {
  try {
    const { endpoint, recipient_id, recipient_role } = req.body;
    if (!endpoint) return res.status(400).json({ success: false, message: "endpoint required" });

    const filter = { endpoint };
    if (recipient_id) filter.recipient_id = String(recipient_id);
    if (recipient_role) filter.recipient_role = recipient_role;

    await PushSubscription.deleteMany(filter);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════
// HR ROUTES — FIRST (important! conflict avoid)
// ══════════════════════════════════════════

// GET /api/notifications/hr/all
router.get("/hr/all", async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipient_role: "hr"
    }).sort({ createdAt: -1 }).limit(50);
    const unreadCount = notifications.filter(n => !n.isRead).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ✅ Role-wide HR notifications (recipient_id null) are shown only from this date onwards.
// Older role-wide ones stay in the database but are hidden from the HR page.
const ROLE_WIDE_FROM = new Date("2026-10-15T00:00:00+05:30"); // 15 Oct 2026, IST

const hrFilter = (hrId) => ({
  recipient_role: "hr",
  $or: [
    { recipient_id: hrId },                                         // this HR's own notifications
    { recipient_id: null, createdAt: { $gte: ROLE_WIDE_FROM } },   // role-wide, from today onwards
  ],
});

// GET /api/notifications/hr/:hrId
router.get("/hr/:hrId", async (req, res) => {
  try {
    const notifications = await Notification.find(hrFilter(req.params.hrId))
      .sort({ createdAt: -1 })
      .limit(50);
    const unreadCount = notifications.filter(n => !n.isRead).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/mark-all-read/hr/:hrId
router.put("/mark-all-read/hr/:hrId", async (req, res) => {
  try {
    await Notification.updateMany(
      { ...hrFilter(req.params.hrId), isRead: false },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/mark-all-read/hr
router.put("/mark-all-read/hr", async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient_role: "hr", isRead: false },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════
// ✅ NEW — HR sends message to employee(s)
// POST /api/notifications/send-hr-message
// Body: { employeeIds: ["all"] or ["id1","id2"], title: string, message: string }
// ══════════════════════════════════════════
router.post("/send-hr-message", async (req, res) => {
  try {
        const { employeeIds, title, message, hrId } = req.body;

    if (!employeeIds || !Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({ success: false, message: "employeeIds required" });
    }
    if (!message || message.trim() === "") {
      return res.status(400).json({ success: false, message: "message required" });
    }

    const notifTitle = title && title.trim() !== "" ? title.trim() : "HR Message";

    // If "all" — fetch all employee ids from existing notifications (or pass from frontend)
    // Frontend sends actual employee id array or ["all"] — handled below
  let targetIds = employeeIds;
if (employeeIds.length === 1 && employeeIds[0] === "all") {
  const allEmployees = await Employee.find(
    { status: { $in: ["approved", "active"] } },   // ✅ rendu status-um cover pannum
    "_id"
  );
  targetIds = allEmployees.map(e => String(e._id));
  if (targetIds.length === 0) {
    return res.status(400).json({ success: false, message: "No approved/active employees found" });
  }
}

    const docs = targetIds.map(empId => ({
      recipient_id:   String(empId),
      recipient_role: "employee",
      type:           "hr_message",
      title:          notifTitle,
      message:        message.trim(),
      link:           "",
      isRead:         false
    }));

        await Notification.insertMany(docs);

    if (hrId) {
      const recipientLabel =
        employeeIds.length === 1 && employeeIds[0] === "all"
          ? "All Employees"
          : `${targetIds.length} employee${targetIds.length === 1 ? "" : "s"}`;

      await Notification.create({
        recipient_id:   String(hrId),
        recipient_role: "hr",
        type:           "hr_message_sent",
        title:          notifTitle,
        message:        `To ${recipientLabel}: ${message.trim()}`,
        link:           "",
        isRead:         true
      });
    }

    res.json({ success: true, sent: docs.length });
  
  } catch (err) {
  console.error("❌ send-hr-message error:", err); // இது terminal-ல காட்டும்
  res.status(500).json({ success: false, message: err.message, stack: err.stack });
}
});

// ══════════════════════════════════════════
// EMPLOYEE ROUTES — BELOW (after HR routes)
// ══════════════════════════════════════════

// GET /api/notifications/:recipientId
router.get("/:recipientId", async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipient_id:   req.params.recipientId,
      recipient_role: "employee"
    }).sort({ createdAt: -1 }).limit(50);
    const unreadCount = notifications.filter(n => !n.isRead).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/:id/read
router.put("/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/mark-all-read/:recipientId
router.put("/mark-all-read/:recipientId", async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient_id: req.params.recipientId, recipient_role: "employee", isRead: false },
      { isRead: true }
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// DELETE /api/notifications/:id
router.delete("/:id", async (req, res) => {
  try {
    await Notification.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/notifications — create new notification
router.post("/", async (req, res) => {
  try {
    const { recipient_id, recipient_role, type, title, message, link } = req.body;
    const notification = await Notification.create({
      recipient_id,
      recipient_role,
      type,
      title,
      message,
      link: link || "",
      isRead: false
    });
    res.json({ success: true, data: notification });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;