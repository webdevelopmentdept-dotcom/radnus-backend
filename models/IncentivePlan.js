// models/IncentivePlan.js
const mongoose = require("mongoose");

// Per-KPI slab (score range → payout)
const KpiSlabSchema = new mongoose.Schema({
  min_score: { type: Number, required: true },
  max_score: { type: Number, required: true },
  type:      { type: String, enum: ["none", "fixed", "percentage"], default: "none" },
  value:     { type: Number, default: 0 },
}, { _id: false });

// Per-KPI configuration block
const KpiConfigSchema = new mongoose.Schema({
  kpi_name:    { type: String, required: true },   // from template
  weight:      { type: Number, default: 0 },        // from template (read-only reference)
  target:      { type: String, default: "" },        // HR types e.g. "120 units"
  value_type:  { type: String, enum: ["count", "percentage", "amount", "rating"], default: "count" },
  operator:    { type: String, enum: [">=", ">", "=", "<=", "<"], default: ">=" },
  rule_label:  { type: String, default: "" },        // auto-generated summary
  slabs:       { type: [KpiSlabSchema], default: [] },
}, { _id: false });

const IncentivePlanSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  department: { type: String, required: true },

  // ── Time Period ────────────────────────────────────────────────────────────
  period_type: {
    type:    String,
    enum:    ["Monthly", "Quarterly", "Half-Yearly", "Yearly"],
    default: "Monthly",
  },
  period_month:   { type: Number, default: null },   // 1-12 (Monthly)
  period_quarter: { type: String, default: null },   // "Q1" | "Q2" | "Q3" | "Q4"
  period_half:    { type: String, default: null },   // "H1" | "H2"
  period_year:    { type: Number, default: () => new Date().getFullYear() },

  // ── Plan type ──────────────────────────────────────────────────────────────
  plan_type: {
    type:    String,
    enum:    ["kpi_linked", "standalone"],
    default: "kpi_linked",
  },

  // ── KPI-Linked fields ──────────────────────────────────────────────────────
  kpi_template_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     "KpiTemplate",
    default: null,
  },

  // Selected & configured KPIs (replaces flat slabs)
  kpi_configs: { type: [KpiConfigSchema], default: [] },

  // Completion reward: if employee hits 100% on ALL selected KPIs
  completion_reward_type:  { type: String, enum: ["none", "fixed", "percentage"], default: "none" },
  completion_reward_value: { type: Number, default: 0 },
  completion_reward_label: { type: String, default: "" }, // e.g. "Star Performer Bonus"

  // ── Standalone fields ──────────────────────────────────────────────────────
  standalone_metric:       { type: String, enum: ["manual", "attendance", "custom"], default: "manual" },
  standalone_metric_label: { type: String, default: "" },
  standalone_payout_type:  { type: String, enum: ["fixed", "percentage"], default: "fixed" },
  standalone_payout_value: { type: Number, default: 0 },
  slabs:                   { type: [KpiSlabSchema], default: [] }, // kept for standalone

}, { timestamps: true });

// Virtual: human-readable period label
IncentivePlanSchema.virtual("period_label").get(function () {
  const y = this.period_year || new Date().getFullYear();
  switch (this.period_type) {
    case "Monthly":     return `${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][(this.period_month||1)-1]} ${y}`;
    case "Quarterly":   return `${this.period_quarter || "Q1"} ${y}`;
    case "Half-Yearly": return `${this.period_half || "H1"} ${y}`;
    case "Yearly":      return `FY ${y}`;
    default:            return `${y}`;
  }
});

IncentivePlanSchema.methods.resolveStandalonePayout = function (salary = 0) {
  if (this.plan_type !== "standalone") return 0;
  if (this.standalone_payout_type === "percentage")
    return Math.round((this.standalone_payout_value / 100) * salary);
  return this.standalone_payout_value;
};

module.exports = mongoose.model("IncentivePlan", IncentivePlanSchema);