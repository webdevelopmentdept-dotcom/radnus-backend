// models/RewardItem.js  reward catalogue (trophy, medal, certificate...) with stock
const mongoose = require('mongoose');
const C = require('../constants/awardMetrics');

const StockLogSchema = new mongoose.Schema({
  delta: Number, reason: String, ref: String, by: String, at: { type: Date, default: Date.now },
}, { _id: false });

const RewardItemSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true, minlength: 2, maxlength: 80 },
  reward_type:   { type: String, required: true, enum: C.REWARD_TYPES.filter((t) => t !== 'cash' && t !== 'points') },
  unit_cost:     { type: Number, default: 0, min: 0 },
  stock_on_hand: { type: Number, default: 0, min: 0 },
  low_stock_at:  { type: Number, default: 5, min: 0 },
  active:        { type: Boolean, default: true },
  stock_log:     { type: [StockLogSchema], default: [] },     // last 100 movements
}, { timestamps: true });

module.exports = mongoose.models.RewardItem || mongoose.model('RewardItem', RewardItemSchema);