const mongoose = require("mongoose");

const alumniProfileSchema = new mongoose.Schema(
  {
    // ── Link to original Employee ──────────────────────────
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      unique: true,
    },

    // ── Basic Info (copied at time of exit) ───────────────
    name:           { type: String, required: true },
    email:          { type: String, required: true },
    phone:          { type: String, default: "" },
    department:     { type: String, default: "" },
    designation:    { type: String, default: "" },
    joiningDate:    { type: Date },
    relievingDate:  { type: Date, required: true },
    tenure:         { type: String, default: "" }, // e.g. "2 years 4 months"
    exitReason:     {
      type: String,
      enum: ["resignation", "termination", "contract_end", "retirement", "other"],
      default: "resignation",
    },

    // ── Alumni Network Fields ─────────────────────────────
    linkedIn:       { type: String, default: "" },
    currentCompany: { type: String, default: "" },
    currentRole:    { type: String, default: "" },
    currentCity:    { type: String, default: "" },

    // ── Network Status ────────────────────────────────────
    networkStatus: {
      type: String,
      enum: ["active", "inactive", "opted_out"],
      default: "active",
    },
    isRehireEligible: { type: Boolean, default: true },
    isBrandAmbassador: { type: Boolean, default: false },

    // ── Engagement ────────────────────────────────────────
    engagementLog: [
      {
        type:    { type: String, enum: ["newsletter", "event", "mentorship", "referral", "rehire_interest", "other"], default: "other" },
        note:    { type: String, default: "" },
        date:    { type: Date, default: Date.now },
        addedBy: { type: String, default: "HR" },
      },
    ],

    // ── Referrals ─────────────────────────────────────────
    referrals: [
      {
        type:        { type: String, enum: ["candidate", "client", "business"], default: "candidate" },
        name:        { type: String, default: "" },
        contactInfo: { type: String, default: "" },
        status:      { type: String, enum: ["pending", "converted", "closed"], default: "pending" },
        date:        { type: Date, default: Date.now },
        notes:       { type: String, default: "" },
      },
    ],

    // ── Mentorship ────────────────────────────────────────
    mentorshipAvailable: { type: Boolean, default: false },
    mentorshipDomains:   [{ type: String }], // e.g. ["Sales", "Tech", "Leadership"]
    mentorshipSessions:  [
      {
        menteeId:   { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
        menteeName: { type: String, default: "" },
        date:       { type: Date, default: Date.now },
        notes:      { type: String, default: "" },
      },
    ],

    // ── Rehire ────────────────────────────────────────────
    rehireStatus: {
      type: String,
      enum: ["not_applied", "interested", "in_process", "rehired", "rejected"],
      default: "not_applied",
    },
    rehireNotes: { type: String, default: "" },

    // ── HR Notes ──────────────────────────────────────────
    hrNotes:     { type: String, default: "" },
    tags:        [{ type: String }], // e.g. ["HiPo", "Boomerang", "Influencer"]
  },
  { timestamps: true }
);

module.exports = mongoose.model("AlumniProfile", alumniProfileSchema);