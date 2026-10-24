const HrAuditLog = require("../models/HrAuditLog");
const { describeByType } = require("./auditEnrich");

// Never throws: a logging failure must not break the real action.
module.exports = async function logAction(
  req,
  { action, entityType = "", entityId = "", entityName = "", remarks = "", meta = null }
) {
  try {
    const a = req.actor || {};
    let name = entityName;
    if (!name && entityId) {
      name = await describeByType(entityType, String(entityId)).catch(() => "");
    }
    await HrAuditLog.create({
      actorId: String(a.id || ""),
      actorName: a.name || "Unknown",
      actorEmail: a.email || "",
      actorRole: a.role || "",
      isTest: !!a.isTest,
      action,
      entityType,
      entityId: String(entityId || ""),
      entityName: name,
      remarks,
      meta,
    });
    req._audited = true;
  } catch (e) {
    console.error("logAction failed:", e.message);
  }
};