const mongoose = require("mongoose");
 
const clubEventSchema = new mongoose.Schema({
  club:             { type: String, enum: ["tech","fitness","creativity"], required: true },
  title:            { type: String, required: true, trim: true },
  activity_type:    { type: String, required: true },
  date:             { type: Date },
  venue:            { type: String, trim: true, default: "" },
  description:      { type: String, trim: true, default: "" },
  max_participants: { type: Number, default: 50 },
  points_awarded:   { type: Number, default: 5 },
  status:           { type: String, enum: ["upcoming","ongoing","completed","cancelled"], default: "upcoming" },
  created_by:       { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
}, { timestamps: true });
 
module.exports = mongoose.model("ClubEvent", clubEventSchema);