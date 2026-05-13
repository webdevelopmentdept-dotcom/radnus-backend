const express  = require("express");
const router   = express.Router();
const moment   = require("moment");
const Employee   = require("../models/Employee");
const Attendance = require("../models/Attendance");

// ─── Plain text body parser (MB20 sends raw tab-separated text) ───
router.use(express.text({ type: "*/*" }));

// ─── ADMS Response (MB20 expects this exact format) ──────────────
function admsResponse(sn) {
  return [
    "GET OPTION FROM: " + sn,
    "Stamp=9999",
    "OpStamp=9999",
    "ErrorDelay=30",
    "Delay=10",
    "TransTimes=00:00;14:05",
    "TransInterval=1",
    "TransFlag=TransData AttLog",
    "Realtime=1",
    "Encrypt=None",
    "",
  ].join("\n");
}

// ─── Parse & Save punch data ──────────────────────────────────────
async function parseAndSave(body) {
  const lines = body.toString().split("\n");

  for (const line of lines) {
    const parts = line.trim().split("\t");
    if (parts.length < 2) continue;

    const esslId   = parts[0]?.trim();       // "142"
    const datetime = parts[1]?.trim();        // "2026-05-13 09:30:00"

    if (!esslId || esslId === "ATTLOG") continue;

    const dt = moment(datetime, [
      "YYYY-MM-DD HH:mm:ss",
      "DD/MM/YYYY HH:mm:ss",
      "YYYY/MM/DD HH:mm:ss",
    ]);

    if (!dt.isValid()) continue;

    const dateStr = dt.format("YYYY-MM-DD");
    const timeVal = dt.toDate();

const employee = await Employee.findOne({ 
  essl_id: { $in: [esslId, Number(esslId)] } 
});

// ← இங்க add பண்ணு ↓
console.log(`🔍 essl_id looking: "${esslId}"`);
console.log(`👤 Found: ${employee ? employee.employeeId : "NOT FOUND ❌"}`);

if (!employee) {
  console.log(`⚠️  No employee for essl_id: ${esslId} — skipping`);
  continue;
}
    // ── Already today's record இருக்கா? ──
    const existing = await Attendance.findOne({
      employee_id: employee._id,
      date: dateStr,
    });

    if (!existing) {
      // First punch → checkIn
      await Attendance.create({
        employee_id: employee._id,
        date:        dateStr,
        checkIn:     timeVal,
        status:      "present",
        method:      "auto",
      });
      console.log(`✅ CheckIn  → ${employee.employeeId} | ${dateStr} ${dt.format("HH:mm:ss")}`);

    } else {
      // Later punch → checkOut update
      const inTime    = moment(existing.checkIn);
      const workHours = parseFloat(dt.diff(inTime, "hours", true).toFixed(2));
      const status    = workHours < 4 ? "half_day" : "present";

      await Attendance.findByIdAndUpdate(existing._id, {
        checkOut:   timeVal,
        work_hours: workHours,
        status:     status,
      });
      console.log(`✅ CheckOut → ${employee.employeeId} | ${dateStr} ${dt.format("HH:mm:ss")} | ${workHours}h`);
    }
  }
}

// ─── All paths MB20 might use ─────────────────────────────────────
const esslPaths = [
  "/iclock/cdata",
  "/iclock/cdata.aspx",
  "/iclock/getrequest",
  "/iclock/getrequest.aspx",
  "/iclock/devicecmd",
  "/iclock/devicecmd.aspx",
  "/ADMS.aspx",
  "/adms.aspx",
  "/adms",
];

// ─── GET — MB20 handshake ─────────────────────────────────────────
esslPaths.forEach((path) => {
  router.get(path, (req, res) => {
    const sn = req.query.SN || req.query.sn || "MB20";
    console.log(`🔗 MB20 Handshake | SN: ${sn} | Path: ${path}`);
    res.set("Content-Type", "text/plain");
    res.status(200).send(admsResponse(sn));
  });
});

// ─── POST — MB20 punch data ───────────────────────────────────────
esslPaths.forEach((path) => {
  router.post(path, async (req, res) => {
    const body  = req.body ? req.body.toString() : "";
    const table = req.query.table || "";
    console.log(`📡 MB20 Data | Table: ${table} | Path: ${path}`);

    if (body && body.trim()) {
      await parseAndSave(body);
    }

    res.set("Content-Type", "text/plain");
    res.status(200).send("OK");
  });
});

module.exports = router;