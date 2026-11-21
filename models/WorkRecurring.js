const mongoose = require("mongoose");

const workRecurringSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },

  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  planned_hours: { type: Number, default: 0 },
  task_type: { type: String, enum: ["normal", "target"], default: "normal" },
  target_value: { type: Number, default: 0 },
  unit: { type: String, default: "" },

  start_date: { type: String, required: true },     // "YYYY-MM-DD"
  end_date: { type: String, default: "" },          // "" = end illa
  days: { type: [String], default: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] },
  only_wfh: { type: Boolean, default: false },      // WFH naal la mattum generate pannu
  close_previous: { type: Boolean, default: false },// pazhaya mudiyaadha task ah auto-close pannu

  active: { type: Boolean, default: true },
  assigned_by_type: { type: String, enum: ["hr", "tl"], default: "hr" },
  assigned_by_id: { type: String, default: "" },
  assigned_by_name: { type: String, default: "" },
  group_id: { type: String, default: "" },
  stopped_by: { type: String, default: "" },
  stopped_at: { type: Date, default: null },
}, { timestamps: true });

workRecurringSchema.index({ active: 1, start_date: 1 });
workRecurringSchema.index({ employee_id: 1, active: 1 });

module.exports = mongoose.model("WorkRecurring", workRecurringSchema);