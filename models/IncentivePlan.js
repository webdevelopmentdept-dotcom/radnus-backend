// models/IncentivePlan.js
const mongoose = require("mongoose");

const SlabSchema = new mongoose.Schema({
  min_score: { type: Number, required: true },
  max_score: { type: Number, required: true },
  type:      { type: String, enum: ["none", "fixed", "percentage"], default: "none" },
  value:     { type: Number, default: 0 },
}, { _id: false });

const IncentivePlanSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  department: { type: String, required: true, trim: true },
  cycle:      { type: String, enum: ["Monthly","Quarterly","Half-Yearly","Yearly"], default: "Monthly" },
  slabs:      [SlabSchema],
}, { timestamps: true });

module.exports = mongoose.model("IncentivePlan", IncentivePlanSchema);