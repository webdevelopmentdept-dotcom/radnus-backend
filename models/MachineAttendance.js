const mongoose = require("mongoose");

const punchSchema = new mongoose.Schema({
  type:   { type: String, enum: ["in", "out"], required: true },
  time:   { type: Date, required: true },
  method: { type: String, default: "auto" },
}, { _id: false });

const machineAttSchema = new mongoose.Schema({
  essl_id:    { type: String, required: true },
  date:       { type: String, required: true },
  punches:    { type: [punchSchema], default: [] },
  first_in:   Date,
  last_out:   Date,
  work_hours: { type: Number, default: 0 },
  status:     { type: String, default: "present" },
}, { timestamps: true });

machineAttSchema.index({ essl_id: 1, date: 1 }, { unique: true });

module.exports =
  mongoose.models.MachineAttendance ||
  mongoose.model("MachineAttendance", machineAttSchema);