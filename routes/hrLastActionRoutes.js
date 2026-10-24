const express = require("express");
const jwt = require("jsonwebtoken");
const HrAuditLog = require("../models/HrAuditLog");
const router = express.Router();

// Any logged-in HR / MD / Admin / Test account may look up "who last acted on this record".
router.use((req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "UNAUTHORIZED" });
    const d = jwt.verify(token, process.env.JWT_SECRET);
    if (d.role !== "hr" && d.role !== "admin") return res.status(403).json({ message: "HR_ONLY" });
    next();
  } catch {
    res.status(401).json({ message: "TOKEN_INVALID" });
  }
});

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// GET /api/hr/last-actions?ids=id1,id2,...&match=APPROVE
//   -> { success, data: { <id>: { name, role, isTest, action, at } } }
router.get("/", async (req, res) => {
  try {
    const ids = String(req.query.ids || "")
      .split(",").map((s) => s.trim())
      .filter((s) => /^[a-f0-9]{24}$/i.test(s))
      .slice(0, 200);
    if (!ids.length) return res.json({ success: true, data: {} });

    const filter = { entityId: { $in: ids } };
    if (req.query.match) filter.action = { $regex: esc(req.query.match), $options: "i" };

    const rows = await HrAuditLog.aggregate([
      { $match: filter },
      { $sort: { createdAt: -1 } },
      { $group: {
          _id: "$entityId",
          name: { $first: "$actorName" },
          role: { $first: "$actorRole" },
          isTest: { $first: "$isTest" },
          action: { $first: "$action" },
          at: { $first: "$createdAt" },
      } },
    ]);

    const data = {};
    rows.forEach((r) => { data[r._id] = { name: r.name, role: r.role, isTest: r.isTest, action: r.action, at: r.at }; });
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, msg: e.message });
  }
});

module.exports = router;