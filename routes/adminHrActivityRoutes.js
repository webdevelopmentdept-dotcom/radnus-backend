const express = require("express");
const jwt = require("jsonwebtoken");
const HrAuditLog = require("../models/HrAuditLog");
const router = express.Router();
const { describeByType } = require("../helpers/auditEnrich");

router.use((req, res, next) => {
  try {
    const token = req.headers.authorization?.split(" ")[1];
    if (!token) return res.status(401).json({ message: "UNAUTHORIZED" });
    const d = jwt.verify(token, process.env.JWT_SECRET);
    if (d.role !== "admin") return res.status(403).json({ message: "ADMIN_ONLY" });
    next();
  } catch {
    res.status(401).json({ message: "TOKEN_INVALID" });
  }
});

function buildFilter(q) {
  const f = {};
  if (q.actorId) f.actorId = q.actorId;
  if (q.action) f.action = { $regex: String(q.action).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" };
  if (q.hideTest === "true") f.isTest = false;
  if (q.from || q.to) {
    f.createdAt = {};
    if (q.from) f.createdAt.$gte = new Date(q.from);
    if (q.to) { const t = new Date(q.to); t.setHours(23, 59, 59, 999); f.createdAt.$lte = t; }
  }
  return f;
}

// GET /api/admin/hr-activity?actorId=&action=&from=&to=&hideTest=&page=1&limit=50
router.get("/", async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const filter = buildFilter(req.query);
    const [data, total] = await Promise.all([
      HrAuditLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      HrAuditLog.countDocuments(filter),
    ]);

    const cache = new Map();
    await Promise.all(data.map(async (r) => {
      if (r.entityName) return;
      const id = [r.entityId, r.meta?.body?.employeeId, r.meta?.body?.employee_id]
        .find((v) => /^[a-f0-9]{24}$/i.test(String(v || "")));
      if (!id) return;
      const key = `${r.entityType}|${id}`;
      if (!cache.has(key)) cache.set(key, describeByType(r.entityType, id).catch(() => ""));
      r.entityName = await cache.get(key);
    }));

    res.json({ success: true, data, total, page, pages: Math.ceil(total / limit) });
  } catch (e) {
    res.status(500).json({ success: false, msg: e.message });
  }
});

// GET /api/admin/hr-activity/summary  -> per HR counts
router.get("/summary", async (req, res) => {
  try {
    const rows = await HrAuditLog.aggregate([
      { $match: buildFilter(req.query) },
      {
        $group: {
          _id: "$actorId", name: { $first: "$actorName" }, role: { $first: "$actorRole" },
          isTest: { $first: "$isTest" }, total: { $sum: 1 }, lastAt: { $max: "$createdAt" },
        }
      },
      { $sort: { total: -1 } },
    ]);
    res.json({ success: true, data: rows });
  } catch (e) {
    res.status(500).json({ success: false, msg: e.message });
  }
});

module.exports = router;