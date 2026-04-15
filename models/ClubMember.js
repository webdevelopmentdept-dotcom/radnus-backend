const mongoose = require("mongoose");
 
const clubMemberSchema = new mongoose.Schema({
  club:        { type: String, enum: ["tech","fitness","creativity"], required: true },
  employee_id: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
  status:      { type: String, enum: ["pending","approved","rejected"], default: "pending" },
  joined_at:   { type: Date },
  total_points:{ type: Number, default: 0 },
}, { timestamps: true });
 
clubMemberSchema.index({ club:1, employee_id:1 }, { unique: true });
module.exports = mongoose.model("ClubMember", clubMemberSchema);