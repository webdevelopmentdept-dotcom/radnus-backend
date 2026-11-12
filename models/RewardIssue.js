// models/RewardIssue.js  one row = one reward given (or planned) to one winner
const mongoose = require('mongoose');
const oid = mongoose.Schema.Types.ObjectId;

const RewardIssueSchema = new mongoose.Schema({
  award_id:   { type: oid, ref: 'AwardDefinition', required: true, index: true },
  award_name: { type: String, default: '' },
  result_id:  { type: oid, ref: 'AwardResult' },

  entity_type:   { type: String, enum: ['employee', 'department'], default: 'employee' },
  entity_key:    { type: String, required: true },
  employee_id:   { type: oid, ref: 'Employee', default: null },
  department:    { type: String, default: '' },
  entity_name:   { type: String, default: '' },
  employee_code: { type: String, default: '' },

  line_index: { type: Number, required: true },     // which reward line of the award
  rank:       { type: Number, default: null },
  reward_type:{ type: String, required: true },
  title:      { type: String, default: '' },

  item_id:   { type: oid, ref: 'RewardItem', default: null },
  item_name: { type: String, default: '' },
  quantity:  { type: Number, default: 1, min: 1 },
  unit_cost: { type: Number, default: 0 },
  cash_amount: { type: Number, default: 0 },
  points:      { type: Number, default: 0 },
  total_cost:  { type: Number, default: 0 },        // cash + quantity x unit_cost

  status: { type: String, enum: ['planned', 'issued', 'cancelled'], default: 'planned', index: true },
  issued_at: { type: Date, default: null },
  issued_by: { type: String, default: '' },
  note: { type: String, default: '' },
  payment_ref: { type: String, default: '' },       // cash: bank / payroll reference
  cancel_reason: { type: String, default: '' },
}, { timestamps: true });

// the same winner cannot get the same reward line twice
RewardIssueSchema.index({ award_id: 1, entity_key: 1, line_index: 1 }, { unique: true });

module.exports = mongoose.models.RewardIssue || mongoose.model('RewardIssue', RewardIssueSchema);