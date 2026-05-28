const mongoose = require("mongoose");

const TechnicianSchema = new mongoose.Schema(
  {
    // ── Personal Info ──────────────────────────────────
    fullName: { type: String, trim: true },
    mobile:   { type: String, trim: true },
    address:  String,
    district: String,
    taluk:    String,

    // ── Work Info ──────────────────────────────────────
    experience:     String,   // "1-2 Years", "3-5 Years" …
    skills:         [String], // ["Hardware", "Software", "iPhone Specialist"]
    brands:         [String], // ["Samsung", "Apple", "Oppo"]
    tools:          [String], // ["Soldering Station", "Hot Air", "DC Power Supply"]
    jobType:        String,   // "Full-time" | "Part-time"
    paymentType:    String,   // "Monthly" | "Daily"
    expectedSalary: Number,
    workLocation:   String,
    joinReady:      String,

    radnusAgree: String,
    remarks:     String,

    // ── Availability Status ────────────────────────────
    // "New"       = just registered
    // "Available" = visible on public board
    // "Interview" = shortlisted / in interview
    // "Hired"     = placed, hide from board
    // "Archived"  = soft-deleted
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