const mongoose = require("mongoose");

const leaveBalanceSchema = new mongoose.Schema({
  employee_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
    unique: true,
  },
  year: { type: Number, default: () => new Date().getFullYear() },

  balances: {
    type: Map,
    of: new mongoose.Schema(
      {
        total: { type: Number, default: 0 },
        used:  { type: Number, default: 0 },
      },
      { _id: false }
    ),
    default: {},
  },
}, { timestamps: true });

module.exports = mongoose.model("LeaveBalance", leaveBalanceSchema);