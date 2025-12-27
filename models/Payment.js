const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema({
  partnerId: { type: mongoose.Schema.Types.ObjectId, ref: "Partner" },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: "Lead" },
  amount: Number,
  txnId: String,
  method: String,
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model("Payment", paymentSchema);
