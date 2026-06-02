const express  = require("express");
const router   = express.Router();
const ExcelJS  = require("exceljs");
const DailyLog = require("../models/DailyLog");       // உங்க model path
const KpiAssignment = require("../models/KpiAssignment"); // உங்க model path

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
  top:    { style: "thin",   color: { argb: "FF" + color } },
  bottom: { style: "thin",   color: { argb: "FF" + color } },
  left:   { style: "thin",   color: { argb: "FF" + color } },
  right:  { style: "thin",   color: { argb: "FF" + color } },
});

// GET /api/export-excel/:assignmentId
router.get("/:assignmentId", async (req, res) => {
  try {
    const { assignmentId } = req.params;

    // Fetch assignment with employee + template KPI items
    const assignment = await KpiAssignment.findById(assignmentId)
      .populate("employee_id")
      .populate("template_id");

    if (!assignment) return res.status(404).json({ message: "Assignment not found" });

    const empName  = assignment.employee_id?.name  || "Employee";
    const period   = assignment.period             || "";
    const empId    = assignment.employee_id?._id;

    // Fetch all logs + totals
    const logs = await DailyLog.find({
      employee_id:   empId,
      assignment_id: assignmentId,
    }).sort({ log_date: -1, createdAt: -1 });

    // Compute running totals per kpi_item_id
    const totals = {};
    logs.forEach(log => {
      const key = log.kpi_item_id?.toString();
      if (key) totals[key] = (totals[key] || 0) + (log.value || 0);
    });

    // ── Build workbook ──────────────────────────────────────
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

    // Title row
    ws1.mergeCells("A1:H1");
    const titleCell = ws1.getCell("A1");
    titleCell.value     = `📊  ${empName.toUpperCase()}  —  PERFORMANCE RUNNING TOTALS  |  ${period.toUpperCase()}`;
    titleCell.font      = { name: "Calibri", bold: true, size: 16, color: { argb: "FFFFFFFF" } };
    titleCell.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A2E" } };
    titleCell.alignment = { vertical: "middle", horizontal: "left", indent: 2 };
    ws1.getRow(1).height = 48;

    // Blue accent stripe
    ws1.mergeCells("A2:H2");
    ws1.getCell("A2").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    ws1.getRow(2).height = 6;

    // Column header row
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

    // KPI data rows
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

      // A — KPI Name
      const a = row.getCell(1);
      a.value     = `  ${item.kpi_name}`;
      a.font      = { name: "Calibri", bold: true, size: 12, color: { argb: "FF1A1A2E" } };
      a.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      a.alignment = { vertical: "middle", horizontal: "left" };
      a.border    = {
        left:   { style: "medium", color: { argb: "FF" + theme.mid } },
        bottom: { style: "thin",   color: { argb: "FFE5E7EB" } },
      };

      // B — Actual
      const b = row.getCell(2);
      b.value     = actual;
      b.font      = { name: "Calibri", bold: true, size: 13, color: { argb: "FF" + theme.mid } };
      b.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + theme.light } };
      b.alignment = { vertical: "middle", horizontal: "center" };
      b.border    = thinBorder();

      // C — Target
      const c = row.getCell(3);
      c.value     = item.target;
      c.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" } };
      c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      c.alignment = { vertical: "middle", horizontal: "center" };
      c.border    = thinBorder();

      // D — Unit
      const d = row.getCell(4);
      d.value     = item.unit;
      d.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" } };
      d.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: rowBg } };
      d.alignment = { vertical: "middle", horizontal: "center" };
      d.border    = thinBorder();

      // E+F — Progress bar (merge)
      ws1.mergeCells(`E${rowNum}:F${rowNum}`);
      const e = row.getCell(5);
      e.value     = bar;
      e.font      = { name: "Consolas", size: 10, color: { argb: "FF" + theme.mid } };
      e.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + theme.bg } };
      e.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
      e.border    = thinBorder();

      // G — Achievement %
      const g = row.getCell(7);
      g.value     = `${pct}%`;
      g.font      = { name: "Calibri", bold: true, size: 13, color: { argb: "FF" + theme.dark } };
      g.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + theme.light } };
      g.alignment = { vertical: "middle", horizontal: "center" };
      g.border    = thinBorder();

      // H — Status
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

    // Blue bottom stripe
    const stripeRow = kpiItems.length + 4;
    ws1.mergeCells(`A${stripeRow}:H${stripeRow}`);
    ws1.getCell(`A${stripeRow}`).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF2563EB" } };
    ws1.getRow(stripeRow).height = 6;

    // Legend row
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
      { key: "date",    width: 16 },
      { key: "day",     width: 14 },
      { key: "kpi",     width: 32 },
      { key: "value",   width: 12 },
      { key: "unit",    width: 10 },
      { key: "note",    width: 30 },
      { key: "time",    width: 12 },
    ];

    // Title
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

    // Headers
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

    // Date color palette
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

      // Date
      const a = row.getCell(1);
      a.value     = `  ${log.log_date}`;
      a.font      = { name: "Calibri", bold: true, size: 11, color: { argb: "FF" + pal.mid } };
      a.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + pal.bg } };
      a.alignment = { vertical: "middle" };
      a.border    = thinB;

      // Day
      const dayName = new Date(log.log_date).toLocaleDateString("en-IN", { weekday: "long" });
      const b = row.getCell(2);
      b.value     = `  ${dayName}`;
      b.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" }, italic: true };
      b.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + pal.bg } };
      b.alignment = { vertical: "middle" };
      b.border    = thinB;

      // KPI Name
      const c = row.getCell(3);
      c.value     = `  ${log.kpi_name}`;
      c.font      = { name: "Calibri", bold: true, size: 11, color: { argb: "FF1A1A2E" } };
      c.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FF" + pal.light } };
      c.alignment = { vertical: "middle" };
      c.border    = thinB;

      // Value
      const d = row.getCell(4);
      d.value     = log.value;
      d.font      = { name: "Calibri", bold: true, size: 13, color: { argb: "FF" + pal.mid } };
      d.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      d.alignment = { vertical: "middle", horizontal: "center" };
      d.border    = thinB;

      // Unit
      const e = row.getCell(5);
      e.value     = log.unit;
      e.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" } };
      e.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      e.alignment = { vertical: "middle", horizontal: "center" };
      e.border    = thinB;

      // Note
      const f = row.getCell(6);
      f.value     = log.note || "";
      f.font      = { name: "Calibri", size: 11, color: { argb: "FF6B7280" }, italic: true };
      f.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      f.alignment = { vertical: "middle" };
      f.border    = thinB;

      // Time
      const g = row.getCell(7);
      g.value     = new Date(log.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
      g.font      = { name: "Calibri", size: 11, color: { argb: "FF9CA3AF" } };
      g.fill      = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFFFFF" } };
      g.alignment = { vertical: "middle", horizontal: "center" };
      g.border    = thinB;
    });

    // ── Send response ────────────────────────────────────────
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