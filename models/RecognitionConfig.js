// models/RecognitionConfig.js  one document: points per old award type + appraisal cap
const mongoose = require('mongoose');

const RecognitionConfigSchema = new mongoose.Schema({
  key: { type: String, default: 'main', unique: true },
  legacy_points: {                                    // Awards Hub (EmployeeAward) points
    spot:         { type: Number, default: 10, min: 0, max: 100 },
    monthly_star: { type: Number, default: 30, min: 0, max: 100 },
    innovation:   { type: Number, default: 50, min: 0, max: 100 },
  },
  cap_points: { type: Number, default: 0, min: 0, max: 500 },   // max recognition points in one appraisal. 0 = no cap
  updated_by_name: { type: String, default: '' },
}, { timestamps: true });

module.exports = mongoose.models.RecognitionConfig || mongoose.model('RecognitionConfig', RecognitionConfigSchema);