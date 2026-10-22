// models/LifeGoalCatalogue.js  (collection: life_goal_catalogue)
const mongoose = require('mongoose');

const catalogueSchema = new mongoose.Schema({
  stage_number:     { type: Number, required: true, min: 1, max: 5 },
  stage_name:       { type: String, required: true },
  goal_title:       { type: String, required: true, maxlength: 120 },
  goal_description: { type: String, default: '', maxlength: 1000 },
  goal_category:    { type: String, required: true },
  display_order:    { type: Number, required: true, min: 1 },
  is_active:        { type: Boolean, default: true },
  updated_by:       { type: String, default: '' },
}, { timestamps: true });

catalogueSchema.index(
  { stage_number: 1, display_order: 1 },
  { unique: true, partialFilterExpression: { is_active: true } }
);

module.exports = mongoose.model('LifeGoalCatalogue', catalogueSchema, 'life_goal_catalogue');