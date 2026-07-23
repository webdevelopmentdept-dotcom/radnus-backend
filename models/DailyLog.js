const mongoose = require('mongoose');

const dailyLogSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Employee',
    required: true
  },
  assignment_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'KpiAssignment',
    required: true
  },
  kpi_item_id: { type: String, required: true },
  kpi_name: { type: String, required: true },
  unit: { type: String },
  value: { type: Number, required: true },   // e.g. 5 calls today
  note: { type: String },                     // optional note
  log_date: { type: String, required: true }, // "2026-03-11"
  period: { type: String, required: true } ,   // "March 2026"
  extra_fields: { type: mongoose.Schema.Types.Mixed, default: {} },
  program_values: { type: mongoose.Schema.Types.Mixed, default: {} },

   isEdited: { type: Boolean, default: false },
   isUnlocked: { type: Boolean, default: false },        // ← NEW
  unlockedAt: { type: Date, default: null },            // ← NEW
  unlockedBy: { type: String, default: null },    
  isDeleted:   { type: Boolean, default: false },
deletedAt:   { type: Date, default: null },
deletedValue:{ type: Number, default: null },   // andha deleted-aana neram irundha value snapshot
deletedNote: { type: String, default: null },    
  editHistory: [{
    oldValue: Number,
    newValue: Number,
    oldNote: String,
    newNote: String,
    editedAt: { type: Date, default: Date.now }
  }]
  
}, { timestamps: true });

module.exports = mongoose.model('DailyLog', dailyLogSchema);