const express  = require('express');
const router   = express.Router();
const axios    = require('axios');
const moment   = require('moment');
const Employee = require('../models/Employee');

// ─── Config ──────────────────────────────────────────────────
const ESSL_SERVER  = process.env.ESSL_SERVER_URL  || 'http://localhost:5000';
const MACHINE_IP   = process.env.ESSL_MACHINE_IP  || '192.168.0.111';
const MACHINE_PORT = process.env.ESSL_MACHINE_PORT || '80';
const MACHINE_BASE = `http://${MACHINE_IP}:${MACHINE_PORT}`;

// ─── Attendance model (same DB) ───────────────────────────────
let Attendance;
try {
  Attendance = require('../models/Attendance');
} catch {
  const mongoose = require('mongoose');
  const s = new mongoose.Schema({
    employee_id:   { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    date:          String,
    punches:       { type: Array, default: [] },
    first_in:      Date,
    last_out:      Date,
    work_hours:    { type: Number, default: 0 },
    checkIn:       Date,
    checkOut:      Date,
    status:        { type: String, default: 'present' },
    shift:         { type: String, default: 'General (9:45 AM – 7:00 PM)' },
    method:        { type: String, default: 'auto' },
    remark:        { type: String, default: '' },
    break_minutes: { type: Number, default: 0 },
  }, { timestamps: true });
  s.index({ employee_id: 1, date: 1 }, { unique: true });
  Attendance = mongoose.models.Attendance || mongoose.model('Attendance', s);
}

// ─── Counter helper ───────────────────────────────────────────
let Counter;
try {
  Counter = require('../models/Counter');
} catch {
  const mongoose = require('mongoose');
  const cs = new mongoose.Schema({ name: String, seq: { type: Number, default: 0 } });
  Counter = mongoose.models.Counter || mongoose.model('Counter', cs);
}

const generateEmployeeId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { name: 'employeeId' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return 'EMP-' + String(counter.seq).padStart(3, '0');
};

// ─── eSSL Bridge Helper ───────────────────────────────────────
async function esslBridge(endpoint, data = {}) {
  try {
    const r = await axios.post(
      `${ESSL_SERVER}/essl-bridge/${endpoint}`, data, { timeout: 7000 }
    );
    return r.data;
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Direct Machine HTTP Helper ───────────────────────────────
async function machineGet(path) {
  try {
    const r = await axios.get(`${MACHINE_BASE}${path}`, { timeout: 8000 });
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function machinePost(path, body) {
  try {
    const r = await axios.post(`${MACHINE_BASE}${path}`, body, {
      timeout: 8000,
      headers: { 'Content-Type': 'text/plain' },
    });
    return { ok: true, data: r.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ─── Parse eSSL user list response ───────────────────────────
function parseUserList(raw) {
  const users = [];
  const lines = (raw || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('GET') || t.startsWith('OK')) continue;
    if (t.startsWith('USER')) {
      const parts = {};
      t.replace('USER ', '').split('\t').forEach(p => {
        const [k, v] = p.split('=');
        if (k) parts[k.trim()] = (v || '').trim();
      });
      if (parts.PIN) {
        users.push({
          essl_id: parts.PIN,
          name:    parts.Name || parts.name || '—',
          card:    parts.Card || '',
          group:   parts.Grp  || '1',
          verify:  parts.Verify || '0',
          pri:     parts.Pri  || '0',
        });
      }
    }
  }
  return users;
}

// ─── Parse attendance log ─────────────────────────────────────
function parseAttLog(raw) {
  const logs  = [];
  const lines = (raw || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.startsWith('GET') || t.startsWith('OK')) continue;
    if (t.startsWith('ATTLOG') || /^\d/.test(t)) {
      const clean = t.replace('ATTLOG ', '');
      const parts = clean.split('\t');
      if (parts.length >= 2) {
        logs.push({
          essl_id:  parts[0]?.trim(),
          datetime: parts[1]?.trim(),
          status:   parts[2]?.trim() || '0',
          verify:   parts[3]?.trim() || '0',
        });
      }
    }
  }
  return logs;
}

// ─── Parse enroll (OPERLOG) ───────────────────────────────────
function parseEnrollLog(raw) {
  const enroll = {};
  const lines  = (raw || '').split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t) continue;
    if (t.includes('ENROLL_FP') || t.includes('ENROLL_FACE')) {
      const isFace   = t.includes('ENROLL_FACE');
      const isFinger = t.includes('ENROLL_FP');
      const pinMatch = t.match(/PIN=(\d+)/);
      const pin = pinMatch?.[1];
      if (pin) {
        if (!enroll[pin]) enroll[pin] = { face: false, finger: false, fingerCount: 0 };
        if (isFace)   enroll[pin].face = true;
        if (isFinger) { enroll[pin].finger = true; enroll[pin].fingerCount++; }
      }
    }
  }
  return enroll;
}

// ═══════════════════════════════════════════════════════════════
//  ── PING ──
// ═══════════════════════════════════════════════════════════════
// GET /api/essl/ping
router.get('/essl/ping', async (req, res) => {
  try {
    const r = await axios.get(`${ESSL_SERVER}/essl-bridge/ping`, { timeout: 4000 });
    res.json(r.data);
  } catch {
    try {
      await axios.get(`${MACHINE_BASE}/iclock/cdata`, { timeout: 3000 });
      res.json({ ok: true, status: 'online', machine: MACHINE_BASE });
    } catch {
      res.json({ ok: false, status: 'offline' });
    }
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── MACHINE: GET ALL USERS ──
// ═══════════════════════════════════════════════════════════════
// GET /api/essl/machine/users
router.get('/essl/machine/users', async (req, res) => {
  try {
    const result = await machineGet('/iclock/cdata?table=employee&Stamp=9999');

    if (!result.ok) {
      return res.status(503).json({
        success: false,
        message: `Machine unreachable: ${result.error}`,
        tip: 'Check ESSL_MACHINE_IP in .env and machine power',
      });
    }

    const machineUsers = parseUserList(result.data);

    const hrmsEmps = await Employee.find({ essl_id: { $ne: null } });
    const hrmsMap  = {};
    hrmsEmps.forEach(e => { hrmsMap[String(e.essl_id)] = e; });

    const enriched = machineUsers.map(u => {
      const hrms = hrmsMap[String(u.essl_id)];
      return {
        ...u,
        in_hrms:      !!hrms,
        hrms_id:      hrms?._id        || null,
        hrms_name:    hrms?.name       || null,
        hrms_dept:    hrms?.department || null,
        hrms_status:  hrms?.status     || null,
        hrms_empId:   hrms?.employeeId || null,
        name_match:   hrms ? hrms.name === u.name : null,
      };
    });

    res.json({
      success:       true,
      total:         enriched.length,
      hrms_linked:   enriched.filter(u => u.in_hrms).length,
      not_in_hrms:   enriched.filter(u => !u.in_hrms).length,
      name_mismatch: enriched.filter(u => u.in_hrms && !u.name_match).length,
      users:         enriched,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── MACHINE: GET ATTENDANCE LOGS ──
// ═══════════════════════════════════════════════════════════════
// GET /api/essl/machine/attendance?date=YYYY-MM-DD
router.get('/essl/machine/attendance', async (req, res) => {
  try {
    const date      = req.query.date  || moment().format('YYYY-MM-DD');
    const startDate = req.query.start || date;
    const endDate   = req.query.end   || date;

    const result = await machineGet(
      `/iclock/cdata?table=ATTLOG&Stamp=9999&StartDate=${startDate}&EndDate=${endDate}`
    );

    if (!result.ok) {
      return res.status(503).json({
        success: false,
        message: `Machine unreachable: ${result.error}`,
      });
    }

    const logs = parseAttLog(result.data);

    const hrmsEmps = await Employee.find({ essl_id: { $ne: null } });
    const hrmsMap  = {};
    hrmsEmps.forEach(e => { hrmsMap[String(e.essl_id)] = e; });

    const enriched = logs.map(log => {
      const hrms = hrmsMap[String(log.essl_id)];
      const verifyLabel = {
        '0': 'Password', '1': 'Fingerprint', '2': 'Card',
        '3': 'Face', '4': 'Palm', '15': 'Unknown',
      }[log.verify] || log.verify;

      return {
        ...log,
        name:         hrms?.name       || 'Unknown',
        department:   hrms?.department || '—',
        employeeId:   hrms?.employeeId || '—',
        in_hrms:      !!hrms,
        verify_label: verifyLabel,
      };
    });

    // Group by essl_id
    const grouped = {};
    enriched.forEach(log => {
      const id = log.essl_id;
      if (!grouped[id]) {
        grouped[id] = {
          essl_id:    id,
          name:       log.name,
          department: log.department,
          employeeId: log.employeeId,
          in_hrms:    log.in_hrms,
          punches:    [],
        };
      }
      grouped[id].punches.push({
        datetime:     log.datetime,
        verify:       log.verify,
        verify_label: log.verify_label,
        status:       log.status,
      });
    });

    res.json({
      success:    true,
      date_range: { start: startDate, end: endDate },
      total_logs: logs.length,
      employees:  Object.values(grouped),
      raw_logs:   enriched,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── MACHINE: GET ENROLL STATUS (Face + Finger) ──
// ═══════════════════════════════════════════════════════════════
// GET /api/essl/machine/enroll-status
// router.get('/essl/machine/enroll-status', async (req, res) => {
//   try {
//     const [usersResult, enrollResult] = await Promise.all([
//       machineGet('/iclock/cdata?table=employee&Stamp=9999'),
//       machineGet('/iclock/cdata?table=OPERLOG&Stamp=9999'),
//     ]);

//     if (!usersResult.ok) {
//       return res.status(503).json({
//         success: false,
//         message: `Machine unreachable: ${usersResult.error}`,
//       });
//     }

//     const users      = parseUserList(usersResult.data);
//     const enrollData = enrollResult.ok ? parseEnrollLog(enrollResult.data) : {};

//     const hrmsEmps = await Employee.find({ essl_id: { $ne: null } });
//     const hrmsMap  = {};
//     hrmsEmps.forEach(e => { hrmsMap[String(e.essl_id)] = e; });

//     const enriched = users.map(u => {
//       const hrms      = hrmsMap[String(u.essl_id)];
//       const enroll    = enrollData[u.essl_id] || { face: false, finger: false, fingerCount: 0 };
//       const verifyNum = parseInt(u.verify || '0');
//       const hasFace   = enroll.face   || verifyNum === 3 || verifyNum === 4;
//       const hasFinger = enroll.finger || verifyNum === 1;

//       return {
//         essl_id:         u.essl_id,
//         name:            u.name,
//         hrms_name:       hrms?.name       || null,
//         department:      hrms?.department || '—',
//         employeeId:      hrms?.employeeId || '—',
//         in_hrms:         !!hrms,
//         face_enrolled:   hasFace,
//         finger_enrolled: hasFinger,
//         finger_count:    enroll.fingerCount || 0,
//         card:            u.card || '—',
//         verify_mode:     u.verify,
//       };
//     });

//     res.json({
//       success:         true,
//       total:           enriched.length,
//       face_enrolled:   enriched.filter(u => u.face_enrolled).length,
//       finger_enrolled: enriched.filter(u => u.finger_enrolled).length,
//       not_enrolled:    enriched.filter(u => !u.face_enrolled && !u.finger_enrolled).length,
//       users:           enriched,
//     });
//   } catch (err) {
//     res.status(500).json({ success: false, message: err.message });
//   }
// });
router.get('/essl/machine/enroll-status', async (req, res) => {
  try {
    const [usersResult, enrollResult] = await Promise.all([
      machineGet('/iclock/cdata?table=employee&Stamp=9999'),
      machineGet('/iclock/cdata?table=OPERLOG&Stamp=9999'),
    ]);

    // ✅ Machine unreachable — fall back to HRMS data gracefully
    if (!usersResult.ok) {
      // ✅ ALL employees regardless of essl_id
      const hrmsEmps = await Employee.find({ status: { $ne: 'inactive' } }).sort({ name: 1 });

      // ✅ Last 30 days punch activity from MongoDB
     const since = moment().subtract(30, 'days').format('YYYY-MM-DD');
const recentAtt = await Attendance.find({
  date: { $gte: since },
}).populate('employee_id', 'essl_id name');

// ✅ Attendance-ல் punch இருந்த eSSL IDs எடு
const esslFromAtt = new Set();
recentAtt.forEach(rec => {
  if (rec.employee_id?.essl_id) {
    esslFromAtt.add(String(rec.employee_id.essl_id));
  }
});

      const punchMap = {};
      recentAtt.forEach(rec => {
        const esslId = rec.employee_id?.essl_id;
        if (!esslId) return;
        if (!punchMap[esslId]) punchMap[esslId] = { days: 0, totalPunches: 0 };
        punchMap[esslId].days++;
        punchMap[esslId].totalPunches += (rec.punches?.length || 0);
      });

      // ✅ Last seen per employee
      const lastAtt = await Attendance.aggregate([
        { $match: { method: 'auto' } },
        { $sort:  { date: -1 } },
        { $group: { _id: '$employee_id', lastDate: { $first: '$date' } } },
      ]);
      const lastSeenMap = {};
      lastAtt.forEach(la => { lastSeenMap[la._id.toString()] = la.lastDate; });

      const fallback = hrmsEmps.map(e => {
        const hasEssl = !!(e.essl_id !== null && e.essl_id !== undefined && String(e.essl_id).trim() !== '');
        const punch   = hasEssl
          ? (punchMap[e.essl_id] || { days: 0, totalPunches: 0 })
          : { days: 0, totalPunches: 0 };
        return {
          essl_id:          e.essl_id || null,
          name:             e.name,
          hrms_name:        e.name,
          department:       e.department  || '—',
          employeeId:       e.employeeId  || '—',
          designation:      e.designation || '—',
          in_hrms:          true,
          has_essl_id:      hasEssl,
          face_enrolled:    false,
          finger_enrolled:  false,
          finger_count:     0,
          card:             '—',
          verify_mode:      '0',
          punch_days_30:    punch.days,
          total_punches:    punch.totalPunches,
          last_seen:        lastSeenMap[e._id.toString()] || null,
          active_in_system: punch.days >= 1 || esslFromAtt.has(String(e.essl_id)),
        };
      });

      const withEssl       = fallback.filter(e => e.has_essl_id).length;
      const noEssl         = fallback.filter(e => !e.has_essl_id).length;
      const activePunchers = fallback.filter(e => e.active_in_system).length;

      return res.status(200).json({
        success:          true,
        machine_online:   false,
        machine_warning:  `Machine unreachable (${usersResult.error}). Showing HRMS data only — enroll status unavailable.`,
        total:            fallback.length,
        with_essl_id:     withEssl,
        no_essl_id:       noEssl,
        face_enrolled:    0,
        finger_enrolled:  0,
        not_enrolled:     noEssl,
        active_punchers:  activePunchers,
        users:            fallback,
      });
    }

    // ✅ Machine IS online — fetch live data
    const users      = parseUserList(usersResult.data);
    const enrollData = enrollResult.ok ? parseEnrollLog(enrollResult.data) : {};

    const hrmsEmps = await Employee.find({ essl_id: { $ne: null } });
    const hrmsMap  = {};
    hrmsEmps.forEach(e => { hrmsMap[String(e.essl_id)] = e; });

    const enriched = users.map(u => {
      const hrms      = hrmsMap[String(u.essl_id)];
      const enroll    = enrollData[u.essl_id] || { face: false, finger: false, fingerCount: 0 };
      const verifyNum = parseInt(u.verify || '0');
      const hasFace   = enroll.face   || verifyNum === 3 || verifyNum === 4;
      const hasFinger = enroll.finger || verifyNum === 1;

      return {
        essl_id:         u.essl_id,
        name:            u.name,
        hrms_name:       hrms?.name       || null,
        department:      hrms?.department || '—',
        employeeId:      hrms?.employeeId || '—',
        designation:     hrms?.designation || '—',
        in_hrms:         !!hrms,
        has_essl_id:     true,
        face_enrolled:   hasFace,
        finger_enrolled: hasFinger,
        finger_count:    enroll.fingerCount || 0,
        card:            u.card || '—',
        verify_mode:     u.verify,
        punch_days_30:   0,
        total_punches:   0,
        last_seen:       null,
        active_in_system: false,
      };
    });

    const withEssl = enriched.filter(u => u.has_essl_id).length;
    const noEssl   = enriched.filter(u => !u.has_essl_id).length;

    res.json({
      success:          true,
      machine_online:   true,
      total:            enriched.length,
      with_essl_id:     withEssl,
      no_essl_id:       noEssl,
      face_enrolled:    enriched.filter(u => u.face_enrolled).length,
      finger_enrolled:  enriched.filter(u => u.finger_enrolled).length,
      not_enrolled:     enriched.filter(u => !u.face_enrolled && !u.finger_enrolled).length,
      active_punchers:  0,
      users:            enriched,
    });

  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});
// ═══════════════════════════════════════════════════════════════
//  ── MACHINE: EDIT USER NAME ──
// ═══════════════════════════════════════════════════════════════
// PUT /api/essl/machine/user/:essl_id
router.put('/essl/machine/user/:essl_id', async (req, res) => {
  try {
    const { essl_id } = req.params;
    const { name, pri, group, verify } = req.body;

    if (!name) return res.status(400).json({ success: false, message: 'Name required' });

    const cmd    = `USER PIN=${essl_id}\tName=${name}\tPri=${pri || '0'}\tPassword=\tCard=\tGrp=${group || '1'}\tTZ=1\tVerify=${verify || '0'}\n`;
    const result = await machinePost('/iclock/cdata?table=employee', cmd);

    if (!result.ok) {
      return res.status(503).json({
        success: false,
        message: `Machine unreachable: ${result.error}`,
      });
    }

    const hrmsEmp = await Employee.findOne({ essl_id });
    if (hrmsEmp) {
      await Employee.findByIdAndUpdate(hrmsEmp._id, { name });
      console.log(`✅ HRMS + Machine name updated: ${essl_id} → ${name}`);
    }

    res.json({
      success:          true,
      message:          `User #${essl_id} updated on machine`,
      hrms_updated:     !!hrmsEmp,
      machine_response: result.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── MACHINE: DELETE USER ──
// ═══════════════════════════════════════════════════════════════
// DELETE /api/essl/machine/user/:essl_id
router.delete('/essl/machine/user/:essl_id', async (req, res) => {
  try {
    const { essl_id }   = req.params;
    const { delete_hrms } = req.query; // ?delete_hrms=true

    const cmd    = `DATA DELETE USERINFO PIN=${essl_id}\n`;
    const result = await machinePost('/iclock/devicecmd', cmd);

    let hrmsDeleted = false;
    if (delete_hrms === 'true') {
      const hrmsEmp = await Employee.findOne({ essl_id });
      if (hrmsEmp) {
        await Employee.findByIdAndDelete(hrmsEmp._id);
        hrmsDeleted = true;
        console.log(`🗑️  HRMS deleted: ${hrmsEmp.name} (${essl_id})`);
      }
    } else {
      await Employee.findOneAndUpdate({ essl_id }, { essl_id: null, essl_sync: false });
    }

    res.json({
      success:          result.ok,
      message:          result.ok
        ? `User #${essl_id} deleted from machine`
        : `Machine delete failed: ${result.error}`,
      hrms_deleted:     hrmsDeleted,
      hrms_cleared:     !hrmsDeleted,
      machine_response: result.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── MACHINE: ENROLL TRIGGER (Face / Finger) ──
// ═══════════════════════════════════════════════════════════════
// POST /api/essl/machine/enroll-trigger
// Body: { essl_id, type: 'face' | 'finger', finger_index: 0-9 }
router.post('/essl/machine/enroll-trigger', async (req, res) => {
  try {
    const { essl_id, type, finger_index } = req.body;

    if (!essl_id) return res.status(400).json({ success: false, message: 'essl_id required' });
    if (!type)    return res.status(400).json({ success: false, message: 'type required (face/finger)' });

    let cmd;
    if (type === 'face') {
      cmd = `C:${Date.now()}:ENROLL_FACE PIN=${essl_id}\n`;
    } else if (type === 'finger') {
      const fid = finger_index !== undefined ? finger_index : 0;
      cmd = `C:${Date.now()}:ENROLL_FP PIN=${essl_id}\tFID=${fid}\tOverwrite=1\n`;
    } else {
      return res.status(400).json({ success: false, message: 'type must be face or finger' });
    }

    const result = await machinePost('/iclock/devicecmd', cmd);

    res.json({
      success: result.ok,
      message: result.ok
        ? `✅ ${type === 'face' ? 'Face' : 'Finger'} enrollment triggered on machine for PIN ${essl_id}. Please ask employee to place ${type === 'face' ? 'face in front of camera' : 'finger on scanner'}.`
        : `Machine command failed: ${result.error}`,
      machine_response: result.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── MACHINE: ADD USER (push to machine) ──
// ═══════════════════════════════════════════════════════════════
// POST /api/essl/machine/user/add
router.post('/essl/machine/user/add', async (req, res) => {
  try {
    const { essl_id, name, pri, group, verify } = req.body;

    if (!essl_id || !name) {
      return res.status(400).json({ success: false, message: 'essl_id and name required' });
    }

    const cmd    = `USER PIN=${essl_id}\tName=${name}\tPri=${pri || '0'}\tPassword=\tCard=\tGrp=${group || '1'}\tTZ=1\tVerify=${verify || '0'}\n`;
    const result = await machinePost('/iclock/cdata?table=employee', cmd);

    res.json({
      success: result.ok,
      message: result.ok
        ? `User #${essl_id} (${name}) added to machine`
        : `Machine add failed: ${result.error}`,
      machine_response: result.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── ESSL EMPLOYEE MANAGEMENT ROUTES ──
// ═══════════════════════════════════════════════════════════════

// POST /api/essl/employees/add
router.post('/essl/employees/add', async (req, res) => {
  try {
    const { name, employeeId, essl_id, department, designation, mobile, email, status } = req.body;

    if (!name) return res.status(400).json({ success: false, message: 'Name required' });

    if (essl_id) {
      const dup = await Employee.findOne({ essl_id });
      if (dup) return res.status(400).json({
        success: false,
        message: `eSSL ID "${essl_id}" already assigned to ${dup.name}`,
      });
    }

    const emp = await Employee.create({
      name,
      employeeId: employeeId || await generateEmployeeId(),
      essl_id:    essl_id || null,
      department, designation, mobile, email,
      status:     status || 'active',
      essl_sync:  false,
    });

    let esslResult = { ok: false, error: 'No eSSL ID — skipped' };
    if (essl_id) {
      esslResult = await esslBridge('employee/add', { essl_id, name });
      if (esslResult.ok) await Employee.findByIdAndUpdate(emp._id, { essl_sync: true });
    }

    const updatedEmp = await Employee.findById(emp._id);
    res.json({
      success: true,
      message: 'Employee added successfully',
      data:    updatedEmp,
      essl_sync: {
        attempted: !!essl_id,
        success:   esslResult.ok,
        message:   esslResult.message || esslResult.error || '',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// PUT /api/essl/employees/:id
router.put('/essl/employees/:id', async (req, res) => {
  try {
    const { name, employeeId, essl_id, department, designation, mobile, email, status } = req.body;

    const oldEmp = await Employee.findById(req.params.id);
    if (!oldEmp) return res.status(404).json({ success: false, message: 'Employee not found' });

    if (essl_id) {
      const dup = await Employee.findOne({ essl_id, _id: { $ne: req.params.id } });
      if (dup) return res.status(400).json({
        success: false,
        message: `eSSL ID "${essl_id}" already assigned to ${dup.name}`,
      });
    }

    const esslIdChanged = oldEmp.essl_id !== essl_id;

    await Employee.findByIdAndUpdate(
      req.params.id,
      {
        name, employeeId,
        essl_id:   essl_id || null,
        department, designation, mobile, email, status,
        ...(esslIdChanged ? { essl_sync: false } : {}),
      },
      { new: true }
    );

    let esslResult = { ok: false, error: 'No eSSL ID — skipped' };
    if (essl_id) {
      esslResult = await esslBridge('employee/update', {
        essl_id, name,
        old_essl_id: oldEmp.essl_id || null,
      });
      if (esslResult.ok) await Employee.findByIdAndUpdate(req.params.id, { essl_sync: true });
    } else if (oldEmp.essl_id && !essl_id) {
      esslResult = await esslBridge('employee/delete', { essl_id: oldEmp.essl_id });
    }

    const finalEmp = await Employee.findById(req.params.id);
    res.json({
      success: true,
      message: 'Employee updated successfully',
      data:    finalEmp,
      essl_sync: {
        attempted: !!(oldEmp.essl_id || essl_id),
        success:   esslResult.ok,
        message:   esslResult.message || esslResult.error || '',
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/essl/employees/:id/sync
router.post('/essl/employees/:id/sync', async (req, res) => {
  try {
    const emp = await Employee.findById(req.params.id);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });
    if (!emp.essl_id) return res.status(400).json({
      success: false,
      message: 'Employee has no eSSL ID.',
    });

    const result = await esslBridge('employee/add', { essl_id: emp.essl_id, name: emp.name });
    if (result.ok) await Employee.findByIdAndUpdate(req.params.id, { essl_sync: true });

    res.json({
      success: result.ok,
      message: result.ok
        ? `${emp.name} synced to machine ✅`
        : `Sync failed: ${result.error}`,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// POST /api/essl/employees/sync-all
router.post('/essl/employees/sync-all', async (req, res) => {
  try {
    const employees = await Employee.find({
      essl_id: { $ne: null, $exists: true },
      status:  { $ne: 'inactive' },
    });

    const results = [];
    for (const emp of employees) {
      const r = await esslBridge('employee/add', { essl_id: emp.essl_id, name: emp.name });
      if (r.ok) await Employee.findByIdAndUpdate(emp._id, { essl_sync: true });
      results.push({ name: emp.name, essl_id: emp.essl_id, success: r.ok });
    }

    const synced = results.filter(r => r.success).length;
    res.json({
      success: true,
      total:   results.length,
      synced,
      failed:  results.length - synced,
      results,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/essl/machine-list
router.get('/essl/machine-list', async (req, res) => {
  try {
    const resp = await axios.get(`${ESSL_SERVER}/essl-bridge/employees`, { timeout: 7000 });
    const machineData   = resp.data;
    const hrmsEmployees = await Employee.find({ essl_id: { $ne: null } });
    const hrmsMap       = {};
    hrmsEmployees.forEach(e => { hrmsMap[e.essl_id] = e; });

    const enriched = (machineData.employees || []).map(e => ({
      ...e,
      in_hrms: !!hrmsMap[e.essl_id],
      hrms_record: hrmsMap[e.essl_id] ? {
        _id:        hrmsMap[e.essl_id]._id,
        name:       hrmsMap[e.essl_id].name,
        employeeId: hrmsMap[e.essl_id].employeeId,
        department: hrmsMap[e.essl_id].department,
      } : null,
    }));

    res.json({
      success:       true,
      machine_count: machineData.count || 0,
      hrms_linked:   enriched.filter(e => e.in_hrms).length,
      not_in_hrms:   enriched.filter(e => !e.in_hrms).length,
      employees:     enriched,
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      message: `Cannot reach eSSL server: ${err.message}`,
    });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── ATTENDANCE CORRECTION ──
// ═══════════════════════════════════════════════════════════════
// POST /api/essl/attendance/correct
router.post('/essl/attendance/correct', async (req, res) => {
  try {
    const { employee_id, date, checkIn, checkOut, status, shift, remark } = req.body;

    if (!employee_id || !date) {
      return res.status(400).json({ success: false, message: 'employee_id and date required' });
    }

    const emp = await Employee.findById(employee_id);
    if (!emp) return res.status(404).json({ success: false, message: 'Employee not found' });

    const checkInDate  = checkIn  ? new Date(checkIn)  : null;
    const checkOutDate = checkOut ? new Date(checkOut) : null;

    const punches = [];
    if (checkInDate)  punches.push({ type: 'in',  time: checkInDate,  method: 'hr-correction' });
    if (checkOutDate) punches.push({ type: 'out', time: checkOutDate, method: 'hr-correction' });

    let work_hours = 0;
    if (checkInDate && checkOutDate) {
      const diffMs  = checkOutDate - checkInDate;
      const breakMs = 60 * 60000; // 1hr lunch
      work_hours = Math.max(parseFloat(((diffMs - breakMs) / 3600000).toFixed(2)), 0);
    }

    const updateData = {
      punches,
      first_in:   checkInDate  || null,
      last_out:   checkOutDate || null,
      checkIn:    checkInDate  || null,
      checkOut:   checkOutDate || null,
      work_hours,
      status:     status || 'present',
      shift:      shift  || 'General (9:45 AM – 7:00 PM)',
      remark:     remark || 'HR Corrected',
      method:     'hr-correction',
    };

    const rec = await Attendance.findOneAndUpdate(
      { employee_id, date },
      { $set: updateData },
      { upsert: true, new: true }
    );

    const h = Math.floor(work_hours);
    const m = Math.round((work_hours - h) * 60);

    console.log(`✏️  Attendance corrected: ${emp.name} | ${date} | ${h}h ${m}m`);

    res.json({
      success:    true,
      message:    `Attendance corrected for ${emp.name} on ${date}`,
      work_hours: `${h}h ${String(m).padStart(2, '0')}m`,
      record:     rec,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  ── GET ATTENDANCE FOR CORRECTION FORM ──
// ═══════════════════════════════════════════════════════════════
// GET /api/essl/attendance/record?employee_id=xxx&date=YYYY-MM-DD
router.get('/essl/attendance/record', async (req, res) => {
  try {
    const { employee_id, date } = req.query;
    if (!employee_id || !date) {
      return res.status(400).json({ success: false, message: 'employee_id and date required' });
    }

    const rec = await Attendance.findOne({ employee_id, date })
      .populate('employee_id', 'name employeeId department essl_id');

    res.json({ success: true, record: rec || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;