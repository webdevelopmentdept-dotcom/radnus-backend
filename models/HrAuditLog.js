const mongoose = require("mongoose");

const auditLogSchema = new mongoose.Schema(
  {
    actorId: { type: String, default: "", index: true },
    actorName: { type: String, default: "Unknown" },
    actorEmail: { type: String, default: "" },
    actorRole: { type: String, default: "" },   // hr / md / tester / admin
    isTest: { type: Boolean, default: false, index: true },

    action: { type: String, required: true, index: true },
    entityType: { type: String, default: "" },
    entityId: { type: String, default: "", index: true },
    entityName: { type: String, default: "" },
    remarks: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });

module.exports = mongoose.models.HrAuditLog || mongoose.model("HrAuditLog", auditLogSchema);