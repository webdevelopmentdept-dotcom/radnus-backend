const mongoose = require("mongoose");

/**
 * PRODUCT MASTER — Knowledge / Product Portal module
 * Each document = one product card (machine, tool, equipment, accessory, or software).
 *
 * Links to existing PMS modules instead of duplicating them:
 *   - trainingProgramId -> TrainingProgram (existing, models/TrainingRca.js)
 *   - sopId             -> SOP             (existing, models/Sop.js)
 * Employee-level completion, scores, and competency stay in the existing
 * EmployeeTraining / ComplianceLog collections — nothing about "who completed what"
 * is stored here, this model is master data only.
 */

const ProductSchema = new mongoose.Schema(
  {
    // ── Identity ────────────────────────────────────────────────
    productName: { type: String, required: true, trim: true },

    productCode: { type: String, required: true, unique: true, trim: true },
    // e.g. "RAD-OCA-001" — generate via the existing Counter model
    // (models/Counter.js) the same way other auto-numbered records do.

    category: {
      type: String,
      required: true,
      enum: [
        "Mobile Service Equipment",
        "Tools",
        "Machinery",
        "Accessories",
        "Software / Tools",
      ],
    },

    // ── Media ───────────────────────────────────────────────────
    // Same Cloudinary pattern as models/Poster.js, just an array instead of one.
    images: [
      {
        url: { type: String, required: true },
        cloudinary_id: { type: String, default: "" },
      },
    ],

    // ── Core content ────────────────────────────────────────────
    // Structured spec table (matches the "SPECIFICATION" box HR gets from
    // suppliers — Usage/Application, Model Number, Machine Type, Brand,
    // Automation Grade, Weight, Features) instead of one free-text field.
    // `extra` covers anything product-specific that doesn't fit the fixed
    // fields (e.g. "Laminating Film: WHITE").
    specification: {
      usageApplication: { type: String, default: "" },
      modelNumber: { type: String, default: "" },
      machineType: { type: String, default: "" },
      brand: { type: String, default: "" },
      automationGrade: { type: String, default: "" },
      weight: { type: String, default: "" },
      features: { type: String, default: "" },
      extra: [
        {
          label: { type: String, required: true },
          value: { type: String, required: true },
        },
      ],
    },
    applications: { type: String, default: "" },
    operatingProcedure: { type: String, default: "" },     // step-by-step, rich text
    safetyInstructions: { type: String, default: "" },

    skillLevel: {
      type: String,
      enum: ["Beginner", "Intermediate", "Advanced"],
      default: "Beginner",
    },

    trainingVideoUrl: { type: String, default: "" },       // LMS / YouTube / Cloudinary video link

    // ── Links to EXISTING modules (reuse, not duplicate) ───────
    sopId: { type: mongoose.Schema.Types.ObjectId, ref: "SOP", default: null },
    // -> resolves to existing SOP model's fileUrl/fileName for download

    trainingProgramId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "TrainingProgram",
      default: null,
    },
    // -> the existing TrainingProgram doc that HR assigns to employees for
    //    this product. EmployeeTraining / ComplianceLog already track
    //    progress, scores, and certification against this programId.

    // ── Support content ─────────────────────────────────────────
    troubleshooting: [
      {
        issue: { type: String, required: true },
        solution: { type: String, required: true },
      },
    ],

    maintenanceSchedule: [
      {
        task: { type: String, required: true },
        frequency: { type: String, required: true }, // "Weekly", "Monthly", etc.
      },
    ],

    relatedProducts: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Product" },
    ],

    trainerNotes: { type: String, default: "" }, // internal, HR/trainer-only

    // ── QR code ─────────────────────────────────────────────────
    qrCodeUrl: { type: String, default: "" },
    // generated on create (npm "qrcode") pointing to the product's public
    // page, e.g. https://radnus.in/product/<productCode>

    // ── Status & audit ──────────────────────────────────────────
    status: {
      type: String,
      enum: ["active", "inactive"],
      default: "active",
    },

    // HR identity in this app is a static login id (e.g. "hr_admin_001"),
    // not a real Employee document — same pattern used everywhere else
    // (routes/hrAuth.js, recipient_id fields, etc). Must be String, not
    // ObjectId ref, or Mongoose throws "Cast to ObjectId failed" on save.
    updatedBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true } // gives createdAt / updatedAt automatically — covers "Last Updated"
);

module.exports = mongoose.model("Product", ProductSchema);