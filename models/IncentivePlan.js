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
  department: { type: String, required: true },
  cycle:      { type: String, enum: ["Monthly", "Quarterly", "Half-Yearly", "Yearly"], default: "Monthly" },

  // ── Plan type ──────────────────────────────────────────────────────────────
  plan_type: {
    type:    String,
    enum:    ["kpi_linked", "standalone"],
    default: "standalone",
  },

  // ── KPI-Linked fields ──────────────────────────────────────────────────────
  kpi_template_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     "KpiTemplate",
    default: null,
  },
  slabs: { type: [SlabSchema], default: [] },

  // ── Standalone fields ──────────────────────────────────────────────────────
  // What metric triggers the payout (manual HR entry, attendance %, or custom)
  standalone_metric: {
    type:    String,
    enum:    ["manual", "attendance", "custom"],
    default: "manual",
  },
  // Label used when standalone_metric === "custom"
  standalone_metric_label: { type: String, default: "" },

  // Whether the payout is a fixed ₹ amount or a % of monthly salary
  standalone_payout_type: {
    type:    String,
    enum:    ["fixed", "percentage"],
    default: "fixed",
  },
  // The actual value — e.g. 5000 (fixed) or 8 (percentage)
  standalone_payout_value: { type: Number, default: 0 },

}, { timestamps: true });

// ── Virtual: resolved payout for standalone (given salary) ────────────────
IncentivePlanSchema.methods.resolveStandalonePayout = function (salary = 0) {
  if (this.plan_type !== "standalone") return 0;
  if (this.standalone_payout_type === "percentage") {
    return Math.round((this.standalone_payout_value / 100) * salary);
  }
  return this.standalone_payout_value;
};

module.exports = mongoose.model("IncentivePlan", IncentivePlanSchema);