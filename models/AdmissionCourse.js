const mongoose = require("mongoose");

// Fee master. category REGULAR = normal course, SCHEME = Government Scheme.
// feeWith = fee with accommodation (null when the course has no such option).
const admissionCourseSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: String, enum: ["REGULAR", "SCHEME"], default: "REGULAR" },
    feeWithout: { type: Number, required: true, min: 0 },
    feeWith: { type: Number, default: null },
    order: { type: Number, default: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// Fees as confirmed by Radnus
const DEFAULT_COURSES = [
  { key: "SEMP_AZ", name: "SEMP A-Z", category: "REGULAR", feeWithout: 47000, feeWith: 75000, order: 1 },
  { key: "STEP_BASIC", name: "STEP (Basic)", category: "REGULAR", feeWithout: 22500, feeWith: null, order: 2 },
  { key: "SEMP_EMMC", name: "SEMP eMMC", category: "REGULAR", feeWithout: 35000, feeWith: null, order: 3 },
  { key: "LEMP_AZ", name: "LEMP A-Z", category: "REGULAR", feeWithout: 50000, feeWith: null, order: 4 },
  { key: "LEMP_BASIC", name: "LEMP Basic", category: "REGULAR", feeWithout: 22000, feeWith: null, order: 5 },
  { key: "LEMP_EMMC", name: "LEMP eMMC", category: "REGULAR", feeWithout: 30000, feeWith: null, order: 6 },
  { key: "IEMP_AZ", name: "IEMP A-Z", category: "REGULAR", feeWithout: 100000, feeWith: null, order: 7 },
  { key: "IEMP_BASIC", name: "IEMP Basic", category: "REGULAR", feeWithout: 22500, feeWith: null, order: 8 },
  { key: "IEMP_EMMC", name: "IEMP eMMC", category: "REGULAR", feeWithout: 75000, feeWith: null, order: 9 },
  { key: "SCHEME_STEP_CHIP", name: "STEP (Chip Level)", category: "SCHEME", feeWithout: 14200, feeWith: null, order: 10 },
  { key: "SCHEME_SEMP_AZ_EMMC", name: "SEMP A-Z eMMC", category: "SCHEME", feeWithout: 42000, feeWith: 50000, order: 11 },
];

const Model = mongoose.model("AdmissionCourse", admissionCourseSchema);

// Idempotent: only inserts when the collection is empty
Model.ensureSeeded = async () => {
  const count = await Model.estimatedDocumentCount();
  if (count === 0) await Model.insertMany(DEFAULT_COURSES);
};

module.exports = Model;