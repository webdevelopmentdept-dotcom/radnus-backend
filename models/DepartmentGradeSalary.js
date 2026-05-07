// models/DepartmentGradeSalary.js
const mongoose = require("mongoose");

const DepartmentGradeSalarySchema = new mongoose.Schema({
  department_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "Department", 
    required: true 
  },
  department_name: { type: String },
  grade_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: "GradeMaster", 
    required: true 
  },
  grade_level: { type: String }, // e.g. "L1" — denormalized for speed
  salary_band_min: { type: Number }, // A scale
  salary_band_mid: { type: Number }, // B scale
  salary_band_max: { type: Number }, // C scale
  posting:         { type: String },   // ✅ NEW — e.g. "Sales Trainee"
years_in_role:   { type: String },
  promotion_timeline: { type: String }, // e.g. "1-2 Years"
  notes: { type: String },
  status: { type: String, default: "active" },
}, { timestamps: true });

// One salary config per dept+grade combo
DepartmentGradeSalarySchema.index(
  { department_id: 1, grade_id: 1 }, 
  { unique: true }
);

module.exports = mongoose.model(
  "DepartmentGradeSalary", 
  DepartmentGradeSalarySchema
);