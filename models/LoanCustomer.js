const mongoose = require("mongoose");

// ── Sub-schema for each govt document (reused 10 times below) ──────────────
const docFieldSchema = {
  url: { type: String, default: "" },
  uploadedAt: { type: Date, default: null },
  status: { type: String, enum: ["pending", "uploaded"], default: "pending" },
};

const loanCustomerSchema = new mongoose.Schema(
  {
    // ── Tab 1: Customer Basic Details ─────────────────────────────────────
    customerName: { type: String, required: true, trim: true },
    communicationAddress: { type: String, default: "" },
    unitAddress: { type: String, default: "" },
    businessType: { type: String, default: "" },
    scheme: {
      type: String,
      enum: ["PMEGP", "UYEGP", "AABCS", ""],
      default: "",
    },
    loanValue: { type: Number, default: 0 },
    contactNo: { type: String, required: true, trim: true },
    mailId: { type: String, default: "", trim: true },
    bankName: { type: String, default: "" },
    ifscCode: { type: String, default: "", uppercase: true },

    // Telecaller who created this record (auto from login)
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    staffName: { type: String, required: true },

    // ── Govt Documents (file upload, Cloudinary URLs) ──────────────────────
    documents: {
      aadharCard: docFieldSchema,
      passportPhoto: docFieldSchema,
      signature: docFieldSchema,
      study10th12th: docFieldSchema,
      community: docFieldSchema,
      pancard: docFieldSchema,
      rationCard: docFieldSchema,
      bankPassbook: docFieldSchema,
      gasBill: docFieldSchema,
      ebBill: docFieldSchema,
    },

    // ── Tab 2: Process Checklist ─────────────────────────────────────────
    checklist: {
      cibilVerification: { type: Boolean, default: false },
      documentCollection: { type: Boolean, default: false },
      applicationProcess: { type: Boolean, default: false },
      quotation: { type: Boolean, default: false },
      auditorReference: { type: Boolean, default: false },
      documentPayment: { type: Boolean, default: false },
      finalisationVerification: { type: Boolean, default: false },
      finalSubmission: { type: Boolean, default: false },
      courier: { type: Boolean, default: false },
      completed: { type: Boolean, default: false },
    },

    processPercent: { type: Number, default: 0 },
    reasonForPending: { type: String, default: "" },

    status: {
      type: String,
      enum: ["IN_PROGRESS", "COMPLETED"],
      default: "IN_PROGRESS",
    },
  },
  { timestamps: true }
);

// Auto-calculate processPercent whenever checklist changes
loanCustomerSchema.pre("save", function (next) {
  const stages = Object.values(this.checklist.toObject ? this.checklist.toObject() : this.checklist);
  const total = stages.length;
  const done = stages.filter(Boolean).length;
  this.processPercent = total ? Math.round((done / total) * 100) : 0;
  this.status = this.checklist.completed ? "COMPLETED" : "IN_PROGRESS";
  next();
});

loanCustomerSchema.index({ staffId: 1 });
loanCustomerSchema.index({ status: 1 });

module.exports = mongoose.model("LoanCustomer", loanCustomerSchema);