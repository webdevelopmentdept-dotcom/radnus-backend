// helpers/lifeGrowthValidators.js
// Constants + input validation for the Life Growth module (no external deps).
const mongoose = require('mongoose');

class ValidationError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.name = 'ValidationError';
    this.status = status;
  }
}

const STAGES = [
  { stage_number: 1, stage_name: 'Basic Financial Stability', timeframe: 'Within 6 months',
    objective: 'Build financial discipline, reduce immediate financial pressure and establish a stable foundation.' },
  { stage_number: 2, stage_name: 'Savings and Financial Security', timeframe: 'Within 1 year',
    objective: 'Strengthen savings and achieve a meaningful personal milestone.' },
  { stage_number: 3, stage_name: 'Asset Building and Financial Progress', timeframe: 'Within 2 years',
    objective: 'Prepare for larger financial and personal milestones.' },
  { stage_number: 4, stage_name: 'Major Life Milestones', timeframe: 'Within 3 years',
    objective: 'Work towards larger personal, family or professional ambitions.' },
  { stage_number: 5, stage_name: 'Wealth and Financial Independence', timeframe: 'Within 4-5 years',
    objective: 'Establish a long-term financial and personal development plan.' },
];

const CATEGORIES = [
  'Financial Stability', 'Debt Reduction', 'Savings', 'Gold and Jewellery', 'Personal Assets',
  'Education', 'Career Development', 'Family', 'Health', 'Entrepreneurship', 'Investments', 'Other',
];

const STATUSES = ['planned', 'in_progress', 'completed', 'paused', 'revised', 'cancelled'];
const ACTIVE_STATUSES = ['planned', 'in_progress', 'paused'];
const TERMINAL_STATUSES = ['completed', 'cancelled', 'revised'];
const PRIORITIES = ['low', 'medium', 'high'];

// action name -> allowed current statuses and resulting status
const ACTIONS = {
  start:    { from: ['planned'],                         to: 'in_progress' },
  pause:    { from: ['planned', 'in_progress'],          to: 'paused' },
  resume:   { from: ['paused'],                          to: 'in_progress' },
  complete: { from: ['in_progress'],                     to: 'completed' },
  cancel:   { from: ['planned', 'in_progress', 'paused'], to: 'cancelled' },
};

// text: undefined = not sent; null/'' = clear (optional fields only)
function cleanText(value, { field, max, min = 0, required = false }) {
  if (value === undefined) {
    if (required) throw new ValidationError(`${field} is required`);
    return undefined;
  }
  if (value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be text`);
  // strip control characters, keep newlines/tabs
  const v = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (required && !v) throw new ValidationError(`${field} is required`);
  if (v.length < min) throw new ValidationError(`${field} must be at least ${min} characters`);
  if (v.length > max) throw new ValidationError(`${field} must be at most ${max} characters`);
  return v;
}

function parseObjectId(value, field) {
  const v = typeof value === 'string' ? value : '';
  if (!mongoose.isValidObjectId(v)) throw new ValidationError(`${field} is invalid`);
  return v;
}

function parseStage(value, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError('Stage is required');
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 5) throw new ValidationError('Stage must be between 1 and 5');
  return n;
}

function parseCategory(value, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError('Category is required');
    return undefined;
  }
  if (!CATEGORIES.includes(value)) throw new ValidationError('Category is invalid');
  return value;
}

function parsePriority(value) {
  if (value === undefined || value === null || value === '') return undefined;
  if (!PRIORITIES.includes(value)) throw new ValidationError('Priority must be low, medium or high');
  return value;
}

function today() {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// accepts YYYY-MM-DD (or ISO); returns Date at UTC midnight
function parseDate(value, field, required = false) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ValidationError(`${field} is required`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ValidationError(`${field} must be a date`);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new ValidationError(`${field} is not a valid date`);
  const y = d.getUTCFullYear();
  if (y < 2000 || y > 2100) throw new ValidationError(`${field} is out of range`);
  return new Date(Date.UTC(y, d.getUTCMonth(), d.getUTCDate()));
}

// rupees (number or numeric string) -> integer paise. undefined = not sent, null/'' = clear
function parseAmount(value, field) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') throw new ValidationError(`${field} must be a number`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) throw new ValidationError(`${field} must be between 0 and 1,000,000,000`);
  return Math.round(n * 100);
}

const paiseToRupees = (p) => (p === null || p === undefined || p === '' ? null : Number(p) / 100);

function parseProgress(value) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 100) throw new ValidationError('Progress must be a whole number from 0 to 100');
  return n;
}

// who a goal is shared with, and how much they see. The employee decides both.
const RECIPIENTS = ['team_lead', 'hr'];
const SCOPES = ['summary', 'full'];

function parseRecipient(value) {
  if (!RECIPIENTS.includes(value)) throw new ValidationError('Choose who to share with: team_lead or hr');
  return value;
}

function parseScope(value) {
  if (!SCOPES.includes(value)) throw new ValidationError('Choose what to share: summary or full');
  return value;
}

function parseVision(body = {}, { partial = false } = {}) {
  const out = {};
  const mission = cleanText(body.personal_mission, { field: 'Personal mission', max: 1500, min: 10, required: !partial });
  const vision = cleanText(body.personal_vision, { field: 'Personal vision', max: 1500, min: 10, required: !partial });
  if (mission !== undefined) out.personal_mission = mission;
  if (vision !== undefined) out.personal_vision = vision;
  return out;
}

module.exports = {
  ValidationError, STAGES, CATEGORIES, STATUSES, ACTIVE_STATUSES, TERMINAL_STATUSES, PRIORITIES, ACTIONS,
  cleanText, parseObjectId, parseStage, parseCategory, parsePriority, parseDate, parseAmount,
  paiseToRupees, parseProgress, parseVision, today, RECIPIENTS, SCOPES, parseRecipient, parseScope,
};