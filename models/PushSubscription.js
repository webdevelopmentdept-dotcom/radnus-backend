const mongoose = require("mongoose");

// One document = one (browser/device + logged-in identity) pair.
// The same browser can be registered for BOTH an HR identity and an employee identity.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    recipient_id:   { type: String, required: true },
    recipient_role: { type: String, enum: ["employee", "hr", "admin"], required: true },

    endpoint: { type: String, required: true },
    keys: {
      p256dh: { type: String, required: true },
      auth:   { type: String, required: true },
    },
    userAgent: { type: String, default: "" },
  },
  { timestamps: true }
);

// same device + same identity = only one record
pushSubscriptionSchema.index(
  { endpoint: 1, recipient_id: 1, recipient_role: 1 },
  { unique: true }
);
// fast lookup when sending
pushSubscriptionSchema.index({ recipient_role: 1, recipient_id: 1 });

module.exports = mongoose.model("PushSubscription", pushSubscriptionSchema);