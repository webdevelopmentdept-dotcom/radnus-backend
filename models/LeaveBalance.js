const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema({
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true, unique: true },
  year:        { type: Number, default: () => new Date().getFullYear() },

  // ✅ Balance per type — matching frontend leave types
  casual_total:    { type: Number, default: 12 },
  casual_used:     { type: Number, default: 0  },

  sick_total:      { type: Number, default: 12 },
  sick_used:       { type: Number, default: 0  },

  annual_total:    { type: Number, default: 15 },
  annual_used:     { type: Number, default: 0  },

  maternity_total: { type: Number, default: 90 },
  maternity_used:  { type: Number, default: 0  },

  paternity_total: { type: Number, default: 15 },
  paternity_used:  { type: Number, default: 0  },

  lop_total:       { type: Number, default: 999 },
  lop_used:        { type: Number, default: 0   },

}, { timestamps: true });

module.exports = mongoose.model("LeaveBalance", leaveBalanceSchema);