const mongoose = require("mongoose");

const docSchema = {
  url: { type: String, default: "" },
  uploadedAt: { type: Date, default: null },
};

const PAYMENT_TYPES = ["Booking Amount", "1st Installment", "2nd Installment", "3rd Installment", "App Payment", "Other"];
const PAYMENT_MODES = ["Cash", "UPI", "Bank", "Card", "Other"];

// A payment is recorded AFTER the application is completed (amounts are not known up front)
const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 1 },
    type: { type: String, enum: PAYMENT_TYPES, default: "Other" },
    paidDate: { type: Date, default: Date.now },
    mode: { type: String, enum: PAYMENT_MODES, required: true },
    refNo: { type: String, default: "", trim: true },
    receivedByName: { type: String, default: "" },
  },
  { timestamps: true }
);

const admissionStudentSchema = new mongoose.Schema(
  {
    // ── Header ───────────────────────────────────────────
    applicationNo: { type: String, unique: true, sparse: true },
    registerNo: { type: String, default: "" }, // snapshot from AdmissionSettings at creation
    batchNo: { type: String, default: "", trim: true },
    billNo: { type: String, default: "", trim: true },
    applicationDate: { type: Date, default: Date.now },

    // BDA = telecaller who created it
    staffId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee", required: true },
    staffName: { type: String, required: true },

    // ── I. Personal Details ─────────────────────────────
    fullName: { type: String, required: true, trim: true },
    dateOfJoining: { type: Date, default: null },

    // Course + optional Government Scheme. Fee comes from scheme if chosen, else course.
    course: {
      courseId: { type: mongoose.Schema.Types.ObjectId, ref: "AdmissionCourse", default: null },
      name: { type: String, default: "" },
    },
    scheme: {
      courseId: { type: mongoose.Schema.Types.ObjectId, ref: "AdmissionCourse", default: null },
      name: { type: String, default: "" },
    },
    accommodation: { type: String, enum: ["WITHOUT", "WITH"], default: "WITHOUT" },

    modeOfCourse: { type: String, enum: ["Regular", "Hybrid"], default: "Regular" },
    hybridNote: { type: String, default: "", trim: true },
    timing: { type: String, default: "", trim: true },
    shopName: { type: String, default: "", trim: true },
    aadhaarNo: { type: String, default: "", trim: true },
    dateOfBirth: { type: Date, default: null },
    postalAddress: { type: String, default: "", trim: true },
    district: { type: String, default: "", trim: true },
    state: { type: String, default: "Tamil Nadu", trim: true },
    pincode: { type: String, default: "", trim: true },
    mobileNo: { type: String, required: true, trim: true },
    gender: { type: String, enum: ["", "Male", "Female", "Others"], default: "" },
    bloodGroup: { type: String, default: "" },
    email: { type: String, default: "", trim: true, lowercase: true },
    differentlyAbled: { type: String, enum: ["", "Yes", "No", "Not applicable"], default: "" },
    emergencyMobile: { type: String, default: "", trim: true },

    // ── II. Academic Details ────────────────────────────
    academic: {
      level: {
        type: String,
        enum: ["", "10th", "12th", "Graduation", "ITI", "Polytechnic", "Others"],
        default: "",
      },
      others: { type: String, default: "", trim: true },
    },

    // ── III. Documents (Cloudinary) ─────────────────────
    documents: {
      photo: docSchema,
      aadhaar: docSchema,
    },

    // ── Fees ────────────────────────────────────────────
    courseFee: { type: Number, default: 0 }, // snapshot of master fee at selection time
    discount: { type: Number, default: 0, min: 0 },
    totalFees: { type: Number, default: 0 }, // courseFee - discount (auto)

    payments: [paymentSchema],

    paidAmount: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },
    paymentStatus: { type: String, enum: ["PENDING", "PARTIAL", "PAID"], default: "PENDING" },

    // ── Lifecycle ───────────────────────────────────────
    status: {
      type: String,
      enum: ["DRAFT", "APPLICATION_COMPLETED", "FULLY_COMPLETED"],
      default: "DRAFT",
    },
    completedAt: { type: Date, default: null },
    fullyCompletedAt: { type: Date, default: null },

    emailStatus: { type: String, enum: ["NOT_SENT", "SENT", "FAILED"], default: "NOT_SENT" },
    emailSentAt: { type: Date, default: null },
    emailError: { type: String, default: "" },
  },
  { timestamps: true }
);

// Auto-calculate totals, payment status and the FULLY_COMPLETED move
admissionStudentSchema.pre("save", function (next) {
  this.totalFees = Math.max(0, (this.courseFee || 0) - (this.discount || 0));

  const paid = (this.payments || []).reduce((a, p) => a + (p.amount || 0), 0);
  this.paidAmount = paid;
  this.balance = Math.max(0, this.totalFees - paid);
  this.paymentStatus = paid <= 0 ? "PENDING" : this.balance === 0 ? "PAID" : "PARTIAL";

  if (this.status !== "DRAFT") {
    const allPaid = this.totalFees > 0 && this.balance === 0;
    if (allPaid && this.status !== "FULLY_COMPLETED") {
      this.status = "FULLY_COMPLETED";
      this.fullyCompletedAt = new Date();
    } else if (!allPaid && this.status === "FULLY_COMPLETED") {
      this.status = "APPLICATION_COMPLETED"; // e.g. admin removed a payment
      this.fullyCompletedAt = null;
    }
  }
  next();
});

admissionStudentSchema.index({ staffId: 1 });
admissionStudentSchema.index({ status: 1 });
admissionStudentSchema.index({ mobileNo: 1 });

const Model = mongoose.model("AdmissionStudent", admissionStudentSchema);
Model.PAYMENT_TYPES = PAYMENT_TYPES;
Model.PAYMENT_MODES = PAYMENT_MODES;
module.exports = Model;