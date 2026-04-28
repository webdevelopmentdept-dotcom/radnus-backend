const mongoose = require("mongoose");

const employeeSchema = new mongoose.Schema({
  employeeId: { type: String, unique: true },

  name: String,
  email: { type: String, unique: true },
  password: String,
 

mobile: {
  type: String,
  unique: true
},

// ✅ இந்த 3 fields add பண்ணு
altMobile: { type: String, default: "" },
dob:       { type: String, default: "" },
address:   { type: String, default: "" },

  department: String,
  designation: String,

  documentsCompleted: {
    type: Boolean,
    default: false
  },

  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending"
  },

  remarks: {
    type: String,
    default: ""
  },

  reuploaded: {
  type: Boolean,
  default: false
},

profileImage: { type: String, default: "" } ,


resetPasswordToken:  { type: String, default: null },
resetPasswordExpiry: { type: Number, default: null },


leadershipTrack: {
    stage: { type: Number, min: 1, max: 5, default: null },
    stageLabel: { type: String, default: "" },
    targetRole: { type: String, default: "" },
    timeline: { type: String, default: "" },
    focusAreas: [{ type: String }],
    expectedOutput: { type: String, default: "" },
    enrolledAt: { type: Date },
    isHiPo: { type: Boolean, default: false },
  },
  mentor: {
    name: { type: String, default: "" },
    designation: { type: String, default: "" },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", default: null },
    lastSessionDate: { type: Date },
    nextSessionDate: { type: Date },
  },
  kpis: [
    {
      metric:    { type: String },
      target:    { type: String },
      frequency: { type: String },
      current:   { type: String, default: "" },
      status:    { type: String, enum: ["on_track","at_risk","achieved"], default: "on_track" },
    }
  ],
  leadershipProgress: [
    {
      date:     { type: Date, default: Date.now },
      note:     { type: String },
      addedBy:  { type: String },
      type:     { type: String, enum: ["mentorship","rotation","training","assessment","milestone"], default: "milestone" },
    }
  ],

}, 

{
  timestamps: true  
});




module.exports = mongoose.model("Employee", employeeSchema);