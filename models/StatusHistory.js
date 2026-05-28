const mongoose = require("mongoose");

const StatusHistorySchema = new mongoose.Schema({
  entityType: {
    type: String,
    enum: ["technician", "shopowner"],
    required: true,
  },
  entityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: "entityType",
  },
  fromStatus: { type: String },
  toStatus:   { type: String, required: true },
  changedBy:  { type: String, default: "admin" },
  note:       { type: String },
  changedAt:  { type: Date, default: Date.now },
});

module.exports = mongoose.model("StatusHistory", StatusHistorySchema);