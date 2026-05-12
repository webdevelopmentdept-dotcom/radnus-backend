const express      = require("express");
const router       = express.Router();
const Notification = require("../models/Notification");
const Employee = require("../models/Employee");

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

// GET /api/notifications/hr/:hrId
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

// PUT /api/notifications/mark-all-read/hr/:hrId
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
    const { employeeIds, title, message } = req.body;

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
  const allEmployees = await Employee.find({ status: "approved" }, "_id");
  targetIds = allEmployees.map(e => String(e._id));
  if (targetIds.length === 0) {
    return res.status(400).json({ success: false, message: "No approved employees found" });
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