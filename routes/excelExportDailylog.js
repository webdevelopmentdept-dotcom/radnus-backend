const express  = require("express");
const router   = express.Router();
const ExcelJS  = require("exceljs");
const DailyLog = require("../models/DailyLog");
const KpiAssignment = require("../models/KpiAssignment");

// Color helpers
const pctTheme = (pct) => {
  if (pct >= 100) return { dark: "166534", mid: "16A34A", light: "DCFCE7", bg: "F0FDF4" };
  if (pct >= 75)  return { dark: "1D4ED8", mid: "2563EB", light: "DBEAFE", bg: "EFF6FF" };
  if (pct >= 50)  return { dark: "92400E", mid: "D97706", light: "FEF3C7", bg: "FFFBEB" };
  return               { dark: "991B1B", mid: "DC2626", light: "FEE2E2", bg: "FEF2F2" };
};

const statusLabel = (pct) => {
  if (pct >= 100) return "✅  ACHIEVED";
  if (pct >= 75)  return "🔵  ON TRACK";
  if (pct >= 50)  return "🟡  NEEDS PUSH";
  return               "🔴  BEHIND";
};

const thinBorder = (color = "D1D5DB") => ({
  top:    { style: "thin", color: { argb: "FF" + color } },
  bottom: { style: "thin", color: { argb: "FF" + color } },
  left:   { style: "thin", color: { argb: "FF" + color } },
  right:  { style: "thin", color: { argb: "FF" + color } },
});

// GET /api/export-excel/all-employees
router.get("/all-employees", async (req, res) => {
  try {
    const today    = new Date().toISOString().split("T")[0];
    const fromDate = req.query.from || today;
    const toDate   = req.query.to   || today;

    const assignments = await KpiAssignment.find({ status: "active" })
      .populate("employee_id")
      .populate("template_id");

    if (!assignments.length)
      return res.status(404).json({ message: "No active assignments found" });

    // ── 1. Collect all logs into flat rows (trimmed & clean) ──
    const clean    = (v) => (typeof v === "string" ? v.trim() : v);
    const isFilled = (v) => v !== undefined && v !== null && String(v).trim() !== "";
    const rows = [];

    for (const assignment of assignments) {
      const empId = assignment.employee_id?._id;
      if (!empId) continue;
      const empName = clean(assignment.employee_id?.name) || "Employee";
      const dept    = clean(assignment.employee_id?.department) || "";

      const kpiTargetMap = {};
      (assignment.template_id?.kpi_items || []).forEach(item => {
        kpiTargetMap[clean(item.kpi_name)] = item.target || 0;
      });

      const logs = await DailyLog.find({
        employee_id:   empId,
        assignment_id: assignment._id,
        log_date:      { $gte: fromDate, $lte: toDate },
      }).sort({ log_date: 1, createdAt: 1 });

      logs.forEach((log) => {
        const kpi = clean(log.kpi_name) || "";
        rows.push({
          emp:    empName,
          dept,
          date:   log.log_date,
          kpi,
          target: kpiTargetMap[kpi] || 0,
          value:  Number(log.value) || 0,        // 0 is kept and shown
          unit:   clean(log.unit) || "",
          note:   clean(log.note) || "",
          extra:  log.extra_fields || {},
          created: log.createdAt ? new Date(log.createdAt).getTime() : 0,
        });
      });
    }

    if (!rows.length)
      return res.status(404).json({ message: `No logs found for: ${fromDate} to ${toDate}` });

    // Sort: Employee (A-Z) → Date → time
    rows.sort((a, b) =>
      a.emp.toLowerCase().localeCompare(b.emp.toLowerCase()) ||
      String(a.date).localeCompare(String(b.date)) ||
      a.created - b.created
    );

    // ── 2. Decide which optional columns actually have data ──
    const EXTRA_LABELS = {
      invoice_no: "Invoice No.", customer_name: "Customer Name", mobile_number: "Mobile",
      price_type: "Price Type", price: "Price", booking_no: "Booking No.",
      booking_count: "Booking Count", model: "Model", fault: "Fault",
      service_charge: "Service Charge", spare: "Spare", status: "Status",
    };
    const EXTRA_ORDER = Object.keys(EXTRA_LABELS);
    const usedKeys = new Set();
    rows.forEach(r => Object.entries(r.extra).forEach(([k, v]) => { if (isFilled(v)) usedKeys.add(k); }));
    const extraKeys = [
      ...EXTRA_ORDER.filter(k => usedKeys.has(k)),
      ...[...usedKeys].filter(k => !EXTRA_ORDER.includes(k)),
    ];
    const prettify = (k) => EXTRA_LABELS[k] || k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
    const LEFT_KEYS = ["customer_name", "model", "fault"];
    const WIDE = { customer_name: 22, model: 18, fault: 28 };

    // Employee & Department are NOT columns — shown once per employee as a banner row
    const columns = [
      { header: "Date",     width: 13, align: "center" },
      { header: "Day",      width: 7,  align: "center" },
      { header: "KPI Name", width: 30, align: "left"   },
      { header: "Target",   width: 12, align: "center" },
      { header: "Value",    width: 12, align: "center" },
      { header: "Unit",     width: 9,  align: "center" },
      { header: "%",        width: 10, align: "center" },
      ...extraKeys.map(k => ({
        header: prettify(k), width: WIDE[k] || 15,
        align: LEFT_KEYS.includes(k) ? "left" : "center",
      })),
      { header: "Note",     width: 36, align: "left"   },
    ];
    const nCols = columns.length;
    const IDX = { date: 0, day: 1, kpi: 2, target: 3, value: 4, unit: 5, pct: 6 };

    // ── 3. Build the sheet ──
    const wb = new ExcelJS.Workbook();
    wb.creator = "Radnus HRMS";
    const ws = wb.addWorksheet("Daily Logs", {
      views: [{ state: "frozen", ySplit: 2, showGridLines: false }],   // header always visible
    });
    ws.columns = columns.map(c => ({ width: c.width }));

    // Title
    const empCount  = new Set(rows.map(r => r.emp)).size;
    const dateLabel = fromDate === toDate ? fromDate : `${fromDate}  to  ${toDate}`;
    ws.mergeCells(1, 1, 1, nCols);
    const titleCell = ws.getCell(1, 1);
    titleCell.value     = `ALL EMPLOYEES - DAILY LOGS   |   ${dateLabel}   |   ${rows.length} entries, ${empCount} employees`;
    titleCell.font      = { name: "Calibri", bold: true, size: 14, color: { argb: "FFFFFFFF" } };
    titleCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(1).height = 36;

    // Header
    ws.getRow(2).height = 28;
    columns.forEach((c, i) => {
      const cell = ws.getCell(2, i + 1);
      cell.value     = c.header;
      cell.font      = { name: "Calibri", bold: true, size: 10.5, color: { argb: "FFFFFFFF" } };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
      cell.alignment = { vertical: "middle", horizontal: c.align === "left" ? "left" : "center" };
      cell.border    = { bottom: { style: "medium", color: { argb: "FF1E40AF" } } };
    });

    const DAY  = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const thin = { style: "thin", color: { argb: "FFE2E8F0" } };
    const pctColor = (p) => (p >= 100 ? "FF16A34A" : p >= 75 ? "FF2563EB" : p >= 50 ? "FFD97706" : "FFDC2626");

    // Group rows by employee (already sorted)
    const groups = [];
    rows.forEach(r => {
      const last = groups[groups.length - 1];
      if (last && last.emp === r.emp && last.dept === r.dept) last.items.push(r);
      else groups.push({ emp: r.emp, dept: r.dept, items: [r] });
    });

    let rowNo = 3;
    groups.forEach((g) => {
      // ── Employee banner (name + department shown ONCE) ──
      ws.mergeCells(rowNo, 1, rowNo, nCols);
      const b = ws.getCell(rowNo, 1);
      b.value     = `${g.emp}   |   ${g.dept || "-"}   |   ${g.items.length} entries`;
      b.font      = { name: "Calibri", bold: true, size: 11.5, color: { argb: "FF1E3A8A" } };
      b.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } };
      b.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      b.border    = { top: { style: "medium", color: { argb: "FF2563EB" } }, bottom: { style: "thin", color: { argb: "FF93C5FD" } } };
      ws.getRow(rowNo).height = 24;
      rowNo++;

      // ── That employee's logs ──
      g.items.forEach((r, i) => {
        const bg = i % 2 === 0 ? "FFFFFFFF" : "FFF8FAFC";

        const [y, m, d] = String(r.date).split("-").map(Number);
        const dateObj   = new Date(Date.UTC(y, m - 1, d));
        const pct       = r.target > 0 ? Math.round((r.value / r.target) * 100) : null;

        const values = [
          dateObj,
          DAY[dateObj.getUTCDay()],
          r.kpi,
          r.target > 0 ? r.target : null,
          r.value,
          r.unit,
          pct === null ? null : pct / 100,
          ...extraKeys.map(k => (isFilled(r.extra[k]) ? clean(r.extra[k]) : null)),
          r.note || null,
        ];

        const row = ws.getRow(rowNo);
        values.forEach((val, ci) => {
          const cell = row.getCell(ci + 1);
          cell.value = val;
          cell.font  = {
            name: "Calibri", size: 10,
            bold:   ci === IDX.kpi || ci === IDX.value || ci === IDX.pct,
            italic: ci === nCols - 1,
            color:  { argb: ci === nCols - 1 ? "FF64748B" : ci === IDX.pct && pct !== null ? pctColor(pct) : "FF1E293B" },
          };
          cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
          cell.alignment = { vertical: "middle", horizontal: columns[ci].align, wrapText: columns[ci].align === "left" };
          cell.border    = { top: thin, bottom: thin, left: thin, right: thin };
          if (ci === IDX.date) cell.numFmt = "dd-mmm-yyyy";
          if (ci === IDX.pct)  cell.numFmt = "0%";
        });
        rowNo++;
      });
    });

    const filename = `All_Employees_DailyLogs_${fromDate}_to_${toDate}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("All employees Excel export error:", err);
    res.status(500).json({ message: "Excel export failed", error: err.message });
  }
});

// GET /api/export-excel/:assignmentId
router.get("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;

    const assignment = await KpiAssignment.findById(assignmentId)
      .populate("employee_id")
      .populate("template_id");

    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    const empName  = assignment.employee_id?.name  || "Employee";
    const period   = assignment.period             || "";
    const empId    = assignment.employee_id?._id;

    const logs = await DailyLog.find({
      employee_id:   empId,
      assignment_id: assignmentId,
    }).sort({ log_date: -1, createdAt: -1 });

    const totals = {};
    logs.forEach(log => {
      const key = log.kpi_item_id?.toString();
      if (key) totals[key] = (totals[key] || 0) + (log.value || 0);
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = "Radnus HRMS";

    // ════════════════════════════════════════════════════════
    // SHEET 1 — RUNNING TOTALS
    // ════════════════════════════════════════════════════════
    const ws1 = wb.addWorksheet("Running Totals", {
      views: [{ showGridLines: false }],
    });

    ws1.columns = [
      { key: "kpi",    width: 30 },
      { key: "actual", width: 14 },
      { key: "target", width: 14 },
      { key: "unit",   width: 10 },
      { key: "bar",    width: 24 },
      { key: "gap",    width:  4 },
      { key: "pct",    width: 16 },
      { key: "status", width: 20 },
    ];

    ws1.mergeCells("A1:H1");
    const titleCell = ws1.getCell("A1");
    titleCell.value     = `📊  ${empName.toUpperCase()}  —  PERFORMANCE RUNNING TOTALS  |  ${period.toUpperCase()}`;
    titleCell.font      = { name: "Calibri", bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
    ws1.getRow(1).height = 48;

    ws1.mergeCells("A2:H2");
    ws1.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    ws1.getRow(2).height = 6;

    ws1.getRow(3).height = 36;
    const colHeaders = ["  KPI Name", "Actual", "Target", "Unit", "Progress Bar", "", "Achievement %", "Status"];
    colHeaders.forEach((h, i) => {
      const cell = ws1.getRow(3).getCell(i + 1);
      cell.value     = h;
      cell.font      = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: i === 0 ? "left" : "center" };
      cell.border    = { bottom: { style: "medium", color: { argb: "FF2563EB" } } };
    });

    const kpiItems = assignment.template_id?.kpi_items || [];
    kpiItems.forEach((item, idx) => {
      const actual  = totals[item._id?.toString()] || 0;
      const pct     = item.target ? Math.round((actual / item.target) * 100) : 0;
      const theme   = pctTheme(pct);
      const label   = statusLabel(pct);
      const filled  = Math.min(Math.round(pct / 5), 20);
      const bar     = "█".repeat(filled) + "░".repeat(20 - filled);
      const rowNum  = idx + 4;
      const isEven  = idx % 2 === 0;
      const rowBg   = isEven ? "FFFFFFFF" : "FFF8FAFC";
      const row     = ws1.getRow(rowNum);
      row.height    = 38;

      const a = row.getCell(1);
      a.value     = `  ${item.kpi_name}`;
      a.font      = { name: "Calibri", bold: true, size: 12, color: { argb: "FF1A1A2E" } };
      a.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      a.alignment = { vertical: "middle", horizontal: "left" };
      a.border    = {
        left:   { style: "medium", color: { argb: "FF" + theme.mid } },
        bottom: { style: "thin",   color: { argb: "FFE5E7EB" } },
      };

      const b = row.getCell(2);
      b.value     = actual;
      b.font      = { name: "Calibri", bold: true, size: 13, color: { argb: "FF" + theme.mid } };
      b.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + theme.light } };
      b.alignment = { vertical: "middle", horizontal: "center" };
      b.border    = thinBorder();

      const c = row.getCell(3);
      c.value     = item.target;
      c.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" } };
      c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      c.alignment = { vertical: "middle", horizontal: "center" };
      c.border    = thinBorder();

      const d = row.getCell(4);
      d.value     = item.unit;
      d.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" } };
      d.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      d.alignment = { vertical: "middle", horizontal: "center" };
      d.border    = thinBorder();

      ws1.mergeCells(`E${rowNum}:F${rowNum}`);
      const e = row.getCell(5);
      e.value     = bar;
      e.font      = { name: "Consolas", size: 10, color: { argb: "FF" + theme.mid } };
      e.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + theme.bg } };
      e.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      e.border    = thinBorder();

      const g = row.getCell(7);
      g.value     = `${pct}%`;
      g.font      = { name: "Calibri", bold: true, size: 13, color: { argb: "FF" + theme.dark } };
      g.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + theme.light } };
      g.alignment = { vertical: "middle", horizontal: "center" };
      g.border    = thinBorder();

      const h = row.getCell(8);
      h.value     = label;
      h.font      = { name: "Calibri", bold: true, size: 10, color: { argb: "FF" + theme.dark } };
      h.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + theme.light } };
      h.alignment = { vertical: "middle", horizontal: "center" };
      h.border    = {
        left:   { style: "medium", color: { argb: "FF" + theme.mid } },
        right:  { style: "medium", color: { argb: "FF" + theme.mid } },
        top:    { style: "thin",   color: { argb: "FFE5E7EB" } },
        bottom: { style: "thin",   color: { argb: "FFE5E7EB" } },
      };
    });

    const stripeRow = kpiItems.length + 4;
    ws1.mergeCells(`A${stripeRow}:H${stripeRow}`);
    ws1.getCell(`A${stripeRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    ws1.getRow(stripeRow).height = 6;

    const legendRow = stripeRow + 2;
    ws1.mergeCells(`A${legendRow}:H${legendRow}`);
    const leg = ws1.getCell(`A${legendRow}`);
    leg.value     = "  COLOR LEGEND:   ✅ Green = 100%+ Achieved     🔵 Blue = 75–99% On Track     🟡 Amber = 50–74% Needs Push     🔴 Red = Below 50% Behind";
    leg.font      = { name: "Calibri", size: 10, color: { argb: "FF374151" }, italic: true };
    leg.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
    leg.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
    leg.border    = { top: { style: "thin", color: { argb: "FFCBD5E1" } } };
    ws1.getRow(legendRow).height = 28;

    // ════════════════════════════════════════════════════════
    // SHEET 2 — DAILY LOGS
    // ════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet("Daily Logs", {
      views: [{ showGridLines: false }],
    });

    ws2.columns = [
      { key: "date",  width: 16 },
      { key: "day",   width: 14 },
      { key: "kpi",   width: 32 },
      { key: "value", width: 12 },
      { key: "unit",  width: 10 },
      { key: "note",  width: 30 },
      { key: "time",  width: 12 },
    ];

    ws2.mergeCells("A1:G1");
    const t2 = ws2.getCell("A1");
    t2.value     = `📅  ${empName.toUpperCase()}  —  DAILY ACTIVITY LOGS  |  ${period.toUpperCase()}  |  ${logs.length} Entries`;
    t2.font      = { name: "Calibri", bold: true, size: 15, color: { argb: "FFFFFFFF" } };
    t2.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
    t2.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
    ws2.getRow(1).height = 48;

    ws2.mergeCells("A2:G2");
    ws2.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF16A34A" } };
    ws2.getRow(2).height = 6;

    const logHeaders = ["  Date", "  Day", "  KPI Name", "Value", "Unit", "Note", "Time"];
    ws2.getRow(3).height = 34;
    logHeaders.forEach((h, i) => {
      const cell = ws2.getRow(3).getCell(i + 1);
      cell.value     = h;
      cell.font      = { name: "Calibri", bold: true, size: 11, color: { argb: "FFFFFFFF" } };
      cell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E293B" } };
      cell.alignment = { vertical: "middle", horizontal: i <= 2 ? "left" : "center" };
      cell.border    = { bottom: { style: "medium", color: { argb: "FF16A34A" } } };
    });

    const datePalettes = {};
    const palettes = [
      { bg: "EFF6FF", mid: "2563EB", light: "DBEAFE" },
      { bg: "F0FDF4", mid: "16A34A", light: "DCFCE7" },
      { bg: "FFFBEB", mid: "D97706", light: "FEF3C7" },
      { bg: "F5F3FF", mid: "7C3AED", light: "EDE9FE" },
      { bg: "FFF1F2", mid: "E11D48", light: "FFE4E6" },
    ];
    let palIdx = 0;
    const getDatePalette = (date) => {
      if (!datePalettes[date]) {
        datePalettes[date] = palettes[palIdx % palettes.length];
        palIdx++;
      }
      return datePalettes[date];
    };

    logs.forEach((log, idx) => {
      const pal    = getDatePalette(log.log_date);
      const rowNum = idx + 4;
      const row    = ws2.getRow(rowNum);
      row.height   = 32;

      const thinB = thinBorder("E5E7EB");

      const a = row.getCell(1);
      a.value     = `  ${log.log_date}`;
      a.font      = { name: "Calibri", bold: true, size: 11, color: { argb: "FF" + pal.mid } };
      a.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + pal.bg } };
      a.alignment = { vertical: "middle" };
      a.border    = thinB;

      const dayName = new Date(log.log_date).toLocaleDateString("en-IN", { weekday: "long" });
      const b = row.getCell(2);
      b.value     = `  ${dayName}`;
      b.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" }, italic: true };
      b.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + pal.bg } };
      b.alignment = { vertical: "middle" };
      b.border    = thinB;

      const c = row.getCell(3);
      c.value     = `  ${log.kpi_name}`;
      c.font      = { name: "Calibri", bold: true, size: 11, color: { argb: "FF1A1A2E" } };
      c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + pal.light } };
      c.alignment = { vertical: "middle" };
      c.border    = thinB;

      const d = row.getCell(4);
      d.value     = log.value;
      d.font      = { name: "Calibri", bold: true, size: 13, color: { argb: "FF" + pal.mid } };
      d.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      d.alignment = { vertical: "middle", horizontal: "center" };
      d.border    = thinB;

      const e = row.getCell(5);
      e.value     = log.unit;
      e.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" } };
      e.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      e.alignment = { vertical: "middle", horizontal: "center" };
      e.border    = thinB;

      const f = row.getCell(6);
      f.value     = log.note || "";
      f.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" }, italic: true };
      f.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      f.alignment = { vertical: "middle" };
      f.border    = thinB;

      const g = row.getCell(7);
      g.value     = new Date(log.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      g.font      = { name: "Calibri", size: 11, color: { argb: "FF9CA3AF" } };
      g.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      g.alignment = { vertical: "middle", horizontal: "center" };
      g.border    = thinB;
    });

    const filename = `${empName.replace(/\s+/g, "_")}_${period}_Performance.xlsx`;
    res.setHeader("Content-Type",        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error("Excel export error:", err);
    res.status(500).json({ message: "Excel export failed", error: err.message });
  }
});

module.exports = router;