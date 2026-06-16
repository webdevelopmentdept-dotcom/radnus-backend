const express = require('express');
const router = express.Router();
const KpiAssignment = require('../models/KpiAssignment');
const DailyLog = require('../models/DailyLog');

// ── /debug route (unchanged) ──────────────────────────────────────────────────
router.get('/debug', async (req, res) => {
  const { period } = req.query;

  const assignments = await KpiAssignment.find({
    period,
    status: { $in: ['active', 'completed'] }
  })
    .populate('employee_id', 'name department')
    .populate('template_id', 'template_name department');

  res.json({
    total_found: assignments.length,
    data: assignments.map(a => ({
      employee:       a.employee_id?.name,
      emp_department: a.employee_id?.department,
      template_dept:  a.template_id?.department,
      period:         a.period,
      status:         a.status
    }))
  });
});

// ── Main scoreboard route ─────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { department, period } = req.query;

    if (!department || !period) {
      return res.status(400).json({
        success: false,
        message: 'department & period are required'
      });
    }

    // ── 1. Fetch assignments ────────────────────────────────────────────────
    const assignments = await KpiAssignment.find({
      period,
      status: { $in: ['active', 'completed'] }
    })
      .populate('employee_id', 'name department')
      .populate('template_id', 'template_name department kpi_items')
      .populate('month_version_id', 'month month_status kpi_items');

    const deptAssignments = assignments.filter(
      a => a.employee_id?.department === department
    );

    if (deptAssignments.length === 0) {
      return res.json({
        success: true,
        data: { dates: [], employees: [], total: null }
      });
    }

    // ── 2. Build a DEPT-WIDE name→colKey map (for TOTAL row only) ──────────
    //    Also build rawIdToColKey so DailyLog entries can be translated.
    const deptKpiMap    = new Map(); // colKey → { kpi_item_id, kpi_name, target, unit }
    const rawIdToColKey = new Map(); // String(subdoc._id) → colKey

    for (const asgn of deptAssignments) {
      const templateItems = asgn.template_id?.kpi_items   || [];
      const monthItems    = asgn.month_version_id?.kpi_items || [];

      templateItems.forEach(item => {
        const colKey   = item.kpi_name.trim().toLowerCase();
        const monthItem = monthItems.find(m => m.kpi_name === item.kpi_name);

        // Register every raw subdoc id → canonical colKey
        rawIdToColKey.set(String(item._id), colKey);

        if (!deptKpiMap.has(colKey)) {
          deptKpiMap.set(colKey, {
            kpi_item_id: colKey,
            kpi_name:    item.kpi_name,
            target:      monthItem?.target ?? item.target,
            unit:        item.unit,
          });
        }
      });
    }

    // ── 3. Date range ───────────────────────────────────────────────────────
    const [monthName, yearStr] = period.split(' ');
    const monthIndex  = new Date(`${monthName} 1, ${yearStr}`).getMonth();
    const year        = Number(yearStr);
    const today       = new Date();
    const isCurrentMonth =
      today.getMonth() === monthIndex && today.getFullYear() === year;
    const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
    const lastDay     = isCurrentMonth ? today.getDate() : daysInMonth;

    const dates = [];
    for (let d = 1; d <= lastDay; d++) {
      const dd = String(d).padStart(2, '0');
      const mm = String(monthIndex + 1).padStart(2, '0');
      dates.push(`${year}-${mm}-${dd}`);
    }

    // ── 4. Per-employee rows — only OWN KPIs ───────────────────────────────
    const employees = [];

    for (const asgn of deptAssignments) {
      const empTemplateItems = asgn.template_id?.kpi_items   || [];
      const empMonthItems    = asgn.month_version_id?.kpi_items || [];

      // Build THIS employee's own KPI column list (name-deduped)
      const empKpiMap = new Map();
      empTemplateItems.forEach(item => {
        const colKey    = item.kpi_name.trim().toLowerCase();
        const monthItem = empMonthItems.find(m => m.kpi_name === item.kpi_name);
        if (!empKpiMap.has(colKey)) {
          empKpiMap.set(colKey, {
            kpi_item_id: colKey,
            kpi_name:    item.kpi_name,
            target:      monthItem?.target ?? item.target,
            unit:        item.unit,
          });
        }
      });

      const empKpiColumns = Array.from(empKpiMap.values());
      const empColKeySet  = new Set(empKpiMap.keys());

      // Initialise metrics & daily for own KPIs only
      const metrics = {};
      const daily   = {};

      empKpiColumns.forEach(col => {
        metrics[col.kpi_item_id] = {
          target:    col.target || 0,
          collected: 0,
          achi:      0,
        };
      });

      dates.forEach(dt => {
        daily[dt] = {};
        empKpiColumns.forEach(col => { daily[dt][col.kpi_item_id] = 0; });
      });

      // Fetch & aggregate logs — skip any colKey not in employee's own set
      const logs = await DailyLog.find({
        employee_id: asgn.employee_id?._id,
        period,
      });

      logs.forEach(log => {
        const colKey = rawIdToColKey.get(String(log.kpi_item_id));
        if (!colKey || !empColKeySet.has(colKey)) return; // not this employee's KPI

        const val = Number(log.value) || 0;

        if (metrics[colKey] !== undefined) {
          metrics[colKey].collected += val;
        }
        if (daily[log.log_date] && daily[log.log_date][colKey] !== undefined) {
          daily[log.log_date][colKey] += val;
        }
      });

      // Compute achievement %
      empKpiColumns.forEach(col => {
        const m = metrics[col.kpi_item_id];
        m.achi = m.target > 0
          ? Math.round((m.collected / m.target) * 100)
          : 0;
      });

      employees.push({
        employee_id:  asgn.employee_id?._id,
        name:         asgn.employee_id?.name || '—',
        kpi_columns:  empKpiColumns,   // ← per-employee column list
        metrics,
        daily,
      });
    }

    // ── 5. TOTAL row — dept-wide union (all KPIs) ──────────────────────────
    const deptKpiColumns = Array.from(deptKpiMap.values());

    const totalMetrics = {};
    const totalDaily   = {};

    deptKpiColumns.forEach(col => {
      totalMetrics[col.kpi_item_id] = { target: 0, collected: 0, achi: 0 };
    });
    dates.forEach(dt => {
      totalDaily[dt] = {};
      deptKpiColumns.forEach(col => { totalDaily[dt][col.kpi_item_id] = 0; });
    });

    employees.forEach(emp => {
      emp.kpi_columns.forEach(col => {
        const kid = col.kpi_item_id;
        if (totalMetrics[kid] !== undefined) {
          totalMetrics[kid].target    += emp.metrics[kid]?.target    || 0;
          totalMetrics[kid].collected += emp.metrics[kid]?.collected || 0;
        }
      });
      dates.forEach(dt => {
        emp.kpi_columns.forEach(col => {
          const kid = col.kpi_item_id;
          if (totalDaily[dt] && totalDaily[dt][kid] !== undefined) {
            totalDaily[dt][kid] += emp.daily[dt]?.[kid] || 0;
          }
        });
      });
    });

    deptKpiColumns.forEach(col => {
      const m = totalMetrics[col.kpi_item_id];
      m.achi = m.target > 0
        ? Math.round((m.collected / m.target) * 100)
        : 0;
    });

    res.json({
      success: true,
      data: {
        // NOTE: No top-level kpi_columns anymore.
        // Each employee carries their own kpi_columns array.
        // Frontend should use emp.kpi_columns to render that employee's rows.
        dates,
        employees,
        total: {
          kpi_columns: deptKpiColumns,  // union — for the TOTAL row
          metrics:     totalMetrics,
          daily:       totalDaily,
        },
      },
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;