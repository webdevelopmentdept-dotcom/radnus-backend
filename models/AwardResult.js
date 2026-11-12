// models/AwardResult.js
// One row = one participant (employee, or department for team awards) in one award.
// Re-evaluating updates the calculated fields only. manual_scores and override are kept.
const mongoose = require('mongoose');

const MetricValueSchema = new mongoose.Schema({
    metric_key: { type: String, required: true },
    raw: { type: Number, default: null },   // real value (%, ₹, count)
    score: { type: Number, default: null },   // normalised 0-100
    weight: { type: Number, default: 0 },
    source: { type: String, enum: ['auto', 'manual'], default: 'auto' },
    missing: { type: Boolean, default: false },
}, { _id: false });

const AwardResultSchema = new mongoose.Schema({
    award_id: { type: mongoose.Schema.Types.ObjectId, ref: 'AwardDefinition', required: true, index: true },
    entity_type: { type: String, enum: ['employee', 'department'], default: 'employee' },
    entity_key: { type: String, required: true },     // employee _id string, or "dept:<name>"
    employee_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', default: null },
    department: { type: String, default: '' },
    entity_name: { type: String, default: '' },
    employee_code: { type: String, default: '' },

    metric_values: { type: [MetricValueSchema], default: [] },
    weighted_score: { type: Number, default: 0 },
    missing_metrics: { type: [String], default: [] },

    eligibility: {
        passed: { type: Boolean, default: true },
        reasons: { type: [String], default: [] },
    },
    facts: {                                            // numbers used for eligibility and tie-breakers
        kpi_percent: { type: Number, default: null },
        attendance_percent: { type: Number, default: null },
        revenue: { type: Number, default: null },
        service_months: { type: Number, default: null },
    },

    rank: { type: Number, default: null },              // calculated rank (eligible only)
    tied: { type: Boolean, default: false },

    manual_scores: { type: mongoose.Schema.Types.Mixed, default: {} },   // { committee_score: 80, ... } 0-100

    override: {
        final_rank: { type: Number, default: null },
        disqualified: { type: Boolean, default: false },
        reason: { type: String, default: '' },
        by: { type: String, default: '' },
        at: { type: Date, default: null },
    },
    final_rank: { type: Number, default: null },        // what winners are picked from

    scheme: {                                           // only for qualifying-days schemes
        source: { type: String, default: '' },            // loan_incentive | sale_entries | daily_log
        total: { type: Number, default: 0 },
        qualifying_days: { type: Number, default: 0 },
        days_required: { type: Number, default: 0 },
    },

    status: { type: String, enum: ['calculated', 'finalized'], default: 'calculated' },
    evaluated_at: { type: Date, default: null },
    finalized_at: { type: Date, default: null },
    finalized_by: { type: String, default: '' },
}, { timestamps: true });

AwardResultSchema.index({ award_id: 1, entity_key: 1 }, { unique: true });

module.exports = mongoose.models.AwardResult || mongoose.model('AwardResult', AwardResultSchema);