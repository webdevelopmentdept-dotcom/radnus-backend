const mongoose = require("mongoose");

const machineUserSchema = new mongoose.Schema({
  essl_id: { type: String, unique: true },
  name:    { type: String, default: "" },
}, { timestamps: true });

module.exports =
  mongoose.models.MachineUser ||
  mongoose.model("MachineUser", machineUserSchema);