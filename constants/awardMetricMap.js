// constants/awardMetricMap.js
// A KPI item is counted for a metric when its kpi_name CONTAINS any keyword (case-insensitive).
// Edit these lists to match the real KPI names in your KPI Templates.
const KPI_KEYWORDS = {
  revenue:         ['revenue', 'sales', 'business value'],
  lead_conversion: ['conversion', 'converted'],
  collection:      ['collection', 'collected', 'recovery'],
  follow_up:       ['follow up', 'follow-up', 'followup'],
};

// Used by the "daily_incentive_count" metric (DailyLog rows whose kpi_name contains one of these)
const DAILY_INCENTIVE_KEYWORDS = ['incentive'];

module.exports = { KPI_KEYWORDS, DAILY_INCENTIVE_KEYWORDS };