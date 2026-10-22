// models/LifeVision.js  (collection: employee_life_visions)
const mongoose = require('mongoose');

const lifeVisionSchema = new mongoose.Schema({
  employee_id:      { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  personal_mission: { type: String, required: true, maxlength: 1500 },
  personal_vision:  { type: String, required: true, maxlength: 1500 },
  status:           { type: String, enum: ['active', 'archived'], default: 'active' },
  version:          { type: Number, default: 1 },
  roadmap_start_date: { type: Date, default: Date.now },
  roadmap_end_date:   { type: Date },
}, { timestamps: true });

// one active roadmap per employee
lifeVisionSchema.index(
  { employee_id: 1 },
  { unique: true, partialFilterExpression: { status: 'active' } }
);

module.exports = mongoose.model('LifeVision', lifeVisionSchema, 'employee_life_visions');