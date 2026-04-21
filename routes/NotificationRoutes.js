const express      = require("express");
const router       = express.Router();
const Notification = require("../models/Notification");

// ══════════════════════════════════════════
// EMPLOYEE ROUTES
// GET  /api/notifications/:recipientId
// PUT  /api/notifications/:id/read
// PUT  /api/notifications/mark-all-read/:recipientId
// ══════════════════════════════════════════

// GET /api/notifications/:recipientId — fetch all for employee
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

// PUT /api/notifications/:id/read — mark one as read
router.put("/:id/read", async (req, res) => {
  try {
    await Notification.findByIdAndUpdate(req.params.id, { isRead: true });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/mark-all-read/:recipientId — employee mark all read
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

// ══════════════════════════════════════════
// HR ROUTES
// GET  /api/notifications/hr/:hrId
// PUT  /api/notifications/mark-all-read/hr/:hrId
// ══════════════════════════════════════════

// GET /api/notifications/hr/:hrId — fetch all for HR
router.get("/hr/:hrId", async (req, res) => {
  try {
    const notifications = await Notification.find({
      recipient_id:   req.params.hrId,
      recipient_role: "hr"
    }).sort({ createdAt: -1 }).limit(50);

    const unreadCount = notifications.filter(n => !n.isRead).length;
    res.json({ success: true, data: notifications, unreadCount });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/notifications/mark-all-read/hr/:hrId — HR mark all read
router.put("/mark-all-read/hr/:hrId", async (req, res) => {
  try {
    await Notification.updateMany(
      { recipient_id: req.params.hrId, recipient_role: "hr", isRead: false },
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

// ✅ Add — HR all notifications (no ID needed)
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

// ✅ Add — HR mark all read
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

module.exports = router;