const mongoose = require("mongoose");

const invalidValueValidator = {
  validator: function (v) {
    if (!v) return false;
    if (typeof v === "string") {
      const val = v.trim();
      return val !== "" && val !== "-" && val !== "--";
    }
    return true;
  },
  message: "Invalid value provided",
};

const ShopOwnerSchema = new mongoose.Schema(
  {
    // ── Core Info ──────────────────────────────────────
    shopName: {
      type: String,
      required: true,
      trim: true,
      validate: invalidValueValidator,
    },
    ownerName: {
      type: String,
      required: true,
      trim: true,
      validate: invalidValueValidator,
    },
    mobile: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: invalidValueValidator,
    },
    district: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    taluk: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    address: String,

    // ── Business Info ──────────────────────────────────
    businessYears: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    needTech: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    technicianTypes: {
      type: [String],
      required: true,
      validate: [(v) => v.length > 0, "Technician type required"],
    },
    jobType: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    experience: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    paymentType: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    salaryRange: String,
    salaryMin: { type: Number },
    salaryMax: { type: Number },
    workingHours: String,
    foodAccommodation: String,
    toolsSetup: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    machines: {
      type: [String],
      required: true,
      validate: [(v) => v.length > 0, "At least one machine required"],
    },
    timeline: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    skills: String,
    radnusHire: {
      type: String,
      required: true,
      validate: invalidValueValidator,
    },
    remarks: String,

    // ── Job Listing Status ─────────────────────────────
    // "Pending"    = just registered, not yet published
    // "Open"       = visible on public job board
    // "In Process" = interview / shortlisting happening
    // "Completed"  = hired successfully
    // "Archived"   = soft-deleted, hidden everywhere
    jobStatus: {
      type: String,
      enum: ["Pending", "Open", "In Process", "Completed", "Archived"],
      default: "Pending",
    },

    // Legacy field kept for backward compatibility
    status: { type: String, default: "Pending" },

    // ── Listing Extras ─────────────────────────────────
    jobTitle: {
      type: String,
      default: "Mobile Service Technician",
    },
    postedAt: { type: Date },
    expiresAt: { type: Date },   // auto-expire after 30 days
    viewCount: { type: Number, default: 0 },
    featured: { type: Boolean, default: false },
    featuredUntil: { type: Date },
  },
  { timestamps: true }
);

// Auto-set postedAt when status flips to Open
ShopOwnerSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  if (update && update.jobStatus === "Open") {
    const now = new Date();
    update.postedAt = now;
    update.expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
  }
  next();
});

module.exports = mongoose.model("ShopOwner", ShopOwnerSchema);