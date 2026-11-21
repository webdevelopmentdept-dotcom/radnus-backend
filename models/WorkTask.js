const mongoose = require("mongoose");

const progressSchema = new mongoose.Schema({
  date: { type: String, required: true },            // entha naal update
  status: { type: String, enum: ["pending", "partial", "completed"], default: "pending" },
  percent: { type: Number, default: 0 },             // antha neram varaikkum cumulative %
  value_today: { type: Number, default: 0 },         // target task: antha naal evlo
  note: { type: String, default: "" },
  at: { type: Date, default: Date.now },
}, { _id: false });

const workTaskSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  date: { type: String, required: true },            // start date "YYYY-MM-DD"
  due_date: { type: String, default: "" },           // optional deadline

  title: { type: String, required: true, trim: true },
  description: { type: String, default: "" },
  priority: { type: String, enum: ["low", "medium", "high"], default: "medium" },
  planned_hours: { type: Number, default: 0 },

  // normal = status based, target = number based (20 calls)
  task_type: { type: String, enum: ["normal", "target"], default: "normal" },
  target_value: { type: Number, default: 0 },
  unit: { type: String, default: "" },
  achieved_value: { type: Number, default: 0 },

  status: { type: String, enum: ["pending", "partial", "completed", "cancelled"], default: "pending" },
  percent: { type: Number, default: 0, min: 0, max: 100 },
  note: { type: String, default: "" },
  completed_at: { type: Date, default: null },
  progress_log: { type: [progressSchema], default: [] },

  cancel_reason: { type: String, default: "" },
  cancelled_by: { type: String, default: "" },
  cancelled_at: { type: Date, default: null },

  assigned_by_type: { type: String, enum: ["hr", "tl", "self"], default: "self" },
  assigned_by_id: { type: String, default: "" },
  assigned_by_name: { type: String, default: "" },
  group_id: { type: String, default: "" },           // oru batch la assign pannina ellaarukkum same
  source: { type: String, enum: ["manual", "recurring"], default: "manual" }, // Step 4
  rule_id: { type: mongoose.Schema.Types.ObjectId, ref: "WorkRecurring", default: null },

  attachments: [{
    url: String,
    name: String,
    mime: String,
    uploadedAt: { type: Date, default: Date.now },
  }],
}, { timestamps: true });

workTaskSchema.index({ employee_id: 1, date: 1 });
workTaskSchema.index({ employee_id: 1, status: 1 });
workTaskSchema.index(
  { rule_id: 1, date: 1 },
  { unique: true, partialFilterExpression: { rule_id: { $type: "objectId" } } }
);

module.exports = mongoose.model("WorkTask", workTaskSchema);