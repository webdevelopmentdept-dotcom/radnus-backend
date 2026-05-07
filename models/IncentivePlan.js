// models/IncentivePlan.js
const mongoose = require("mongoose");

// ── Slab schema (score range → payout) ───────────────────────────────────────
const KpiSlabSchema = new mongoose.Schema({
  min_score: { type: Number, required: true },
  max_score: { type: Number, required: true },
  type:      { type: String, enum: ["none", "fixed", "target_percentage"], default: "none" },
  value:     { type: Number, default: 0 },
}, { _id: false });

// ── Per-program slab block (for Admission KPIs) ───────────────────────────────
const ProgramSlabSchema = new mongoose.Schema({
  program_id:   { type: String, required: true },
  program_name: { type: String, default: "" },
  slabs:        { type: [KpiSlabSchema], default: [] },
}, { _id: false });

// ── Program target (mirrors KPI template) ────────────────────────────────────
const ProgramTargetSchema = new mongoose.Schema({
  program_id:   { type: String, required: true },
  program_name: { type: String, default: "" },
  target:       { type: Number, default: 0 },
}, { _id: false });

// ── Per-KPI configuration block ───────────────────────────────────────────────
const KpiConfigSchema = new mongoose.Schema({
  kpi_name:         { type: String, required: true },
  weight:           { type: Number, default: 0 },
  target:           { type: String, default: "" },
  value_type:       { type: String, enum: ["count", "percentage", "amount", "rating"], default: "count" },
  operator:         { type: String, enum: [">=", ">", "=", "<=", "<"], default: ">=" },
  rule_label:       { type: String, default: "" },

  // ── Admission KPI fields ──────────────────────────────────────────────────
  is_admission_kpi: { type: Boolean, default: false },
  program_targets:  { type: [ProgramTargetSchema], default: [] },
  program_slabs:    { type: [ProgramSlabSchema],   default: [] },

  // ── Normal KPI slabs ──────────────────────────────────────────────────────
  slabs: { type: [KpiSlabSchema], default: [] },
}, { _id: false });

// ── Main IncentivePlan Schema ─────────────────────────────────────────────────
const IncentivePlanSchema = new mongoose.Schema({
  name:       { type: String, required: true, trim: true },
  department: { type: String, required: true },

  // Time Period
  period_type: {
    type:    String,
    enum:    ["Monthly", "Quarterly", "Half-Yearly", "Yearly"],
    default: "Monthly",
  },
  period_month:   { type: Number, default: null },
  period_quarter: { type: String, default: null },
  period_half:    { type: String, default: null },
  period_year:    { type: Number, default: () => new Date().getFullYear() },

  // Plan type
  plan_type: {
    type:    String,
    enum:    ["kpi_linked", "standalone"],
    default: "kpi_linked",
  },

  // KPI-Linked fields
  kpi_template_id: {
    type:    mongoose.Schema.Types.ObjectId,
    ref:     "KpiTemplate",
    default: null,
  },
  kpi_configs: { type: [KpiConfigSchema], default: [] },

  // Completion reward
  completion_reward_type:  { type: String, enum: ["none", "fixed", "percentage"], default: "none" },
  completion_reward_value: { type: Number, default: 0 },
  completion_reward_label: { type: String, default: "" },

  // Standalone fields
  standalone_metric:       { type: String, enum: ["manual", "attendance", "custom"], default: "manual" },
  standalone_metric_label: { type: String, default: "" },
  standalone_payout_type:  { type: String, enum: ["fixed", "percentage"], default: "fixed" },
  standalone_payout_value: { type: Number, default: 0 },
  slabs:                   { type: [KpiSlabSchema], default: [] },

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