const mongoose = require("mongoose");

const TechnicianSchema = new mongoose.Schema(
  {
    // ── Personal Info ──────────────────────────────────
    fullName: { type: String, trim: true },
    mobile:   { type: String, trim: true, unique: true }, // ✅ unique added
    address:  String,
    state:    { type: String, trim: true },               // ✅ new field
    district: String,
    taluk:    String,

    // ── Work Info ──────────────────────────────────────
    experience:     String,
    skills:         [String],
    brands:         [String],
    tools:          [String],
    jobType:        String,
    paymentType:    String,
    expectedSalary: Number,
    workLocation:   String,
    joinReady:      String,

    radnusAgree: String,
    remarks:     String,

    // ── Availability Status ────────────────────────────
    availabilityStatus: {
      type: String,
      enum: ["New", "Available", "Interview", "Hired", "Archived"],
      default: "New",
    },

    // Legacy field
    status: { type: String, default: "New" },

    // ── Listing Extras ─────────────────────────────────
    featured:      { type: Boolean, default: false },
    featuredUntil: { type: Date },
    profileViews:  { type: Number, default: 0 },
    publishedAt:   { type: Date },
  },
  { timestamps: true }
);

// Auto-set publishedAt when status flips to Available
TechnicianSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  if (update && update.availabilityStatus === "Available" && !update.publishedAt) {
    update.publishedAt = new Date();
  }
  next();
});

module.exports = mongoose.model("Technician", TechnicianSchema);