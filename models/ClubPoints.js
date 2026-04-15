const mongoose = require("mongoose");
 
const clubPointsSchema = new mongoose.Schema({
  club:          { type: String, enum: ["tech","fitness","creativity"], required: true },
  employee_id:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  points:        { type: Number, required: true },
  activity_type: { type: String, required: true },
  reason:        { type: String, default: "" },
  awarded_by:    { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
}, { timestamps: true });
 
module.exports = mongoose.model("ClubPoints", clubPointsSchema);