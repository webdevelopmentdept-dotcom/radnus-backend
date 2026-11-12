const mongoose = require("mongoose");

// Draft = half-filled "Customer Details" form. Separate collection so none of the
// existing LoanCustomer queries (reports, analytics, followup, incentive...) are affected.
// Nothing is required here (except staffId) — a draft can be saved blank.

const DOC_KEYS = [
  "aadharCard", "passportPhoto", "signature", "study10th12th", "community",
  "pancard", "rationCard", "bankPassbook", "gasBill", "ebBill",
];

const documents = {};
DOC_KEYS.forEach((k) => {
  documents[k] = {
    url: { type: String, default: "" },
    uploadedAt: { type: Date, default: null },
  };
});

const loanDraftSchema = new mongoose.Schema(
  {
    customerName: { type: String, default: "", trim: true },
    loanDate: { type: Date, default: Date.now },
    communicationAddress: { type: String, default: "" },
    unitAddress: { type: String, default: "" },
    businessType: { type: String, default: "" },
    businessSubType: { type: String, default: "" },
    scheme: { type: String, default: "" },
    loanValue: { type: Number, default: 0 },
    contactNo: { type: String, default: "", trim: true },
    mailId: { type: String, default: "", trim: true },
    bankName: { type: String, default: "" },
    ifscCode: { type: String, default: "", uppercase: true },
    fatherName: { type: String, default: "", trim: true },
    fatherOccupation: { type: String, default: "", trim: true },
    maritalStatus: { type: String, enum: ["", "Married", "Unmarried"], default: "" },
    spouseName: { type: String, default: "", trim: true },
    spouseOccupation: { type: String, default: "", trim: true },

    documents,

    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    staffName: { type: String, default: "" },
  },
  { timestamps: true }
);

loanDraftSchema.index({ staffId: 1, updatedAt: -1 });

module.exports = mongoose.model("LoanDraft", loanDraftSchema);