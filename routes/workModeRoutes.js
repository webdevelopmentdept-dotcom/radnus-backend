// routes/workModeRoutes.js
const express = require("express");
const router = express.Router();
const Employee = require("../models/Employee");
const Attendance = require("../models/Attendance");
const auth = require("../middleware/auth");
const hrOnly = require("../middleware/hrOnly");
const { getEffectiveWorkMode } = require("../helpers/workMode");
const { createNotification } = require("../helpers/notificationHelper");

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
// IST date (server UTC la irundhaalum correct date varum)
const todayIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

const FIELDS =
  "name employeeId email department designation workMode wfhFrom wfhTo wfhDays wfhReason wfhApprovedBy";

// ── Employee: en own work mode ───────────────────────────────
router.get("/me", auth, async (req, res) => {
  try {
    const emp = await Employee.findById(req.user.id).select(FIELDS).lean();
    if (!emp) return res.status(404).json({ success: false, message: "NOT_FOUND" });
    res.json({
      success: true,
      data: { ...emp, effectiveToday: getEffectiveWorkMode(emp, todayIST()) },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── HR: ellaa employees + mode ───────────────────────────────
router.get("/", auth, hrOnly, async (req, res) => {
  try {
    const { q = "", dept = "", mode = "" } = req.query;
    const filter = {
      status: { $in: ["approved", "active"] },
      staffType: { $ne: "machine_staff" },
      exitType: null,
      accessDeactivated: { $ne: true },
    };
    if (dept) filter.department = dept;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: rx }, { email: rx }, { employeeId: rx }];
    }

    const today = todayIST();
    let rows = (await Employee.find(filter).select(FIELDS).sort({ name: 1 }).lean()).map((e) => ({
      ...e,
      effectiveToday: getEffectiveWorkMode(e, today),
    }));
    if (mode === "wfh" || mode === "office") rows = rows.filter((r) => r.effectiveToday === mode);

    res.json({ success: true, total: rows.length, today, data: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── HR: oru employee ku mode set ─────────────────────────────
router.put("/:employeeId", auth, hrOnly, async (req, res) => {
  try {
    const { workMode, wfhFrom = "", wfhTo = "", wfhDays = [], wfhReason = "" } = req.body;

    if (!["office", "wfh", "hybrid"].includes(workMode))
      return res.status(400).json({ success: false, message: "Invalid work mode" });

    let update;
    if (workMode === "office") {
      update = { workMode: "office", wfhFrom: "", wfhTo: "", wfhDays: [], wfhReason: "", wfhApprovedBy: "" };
    } else {
      if (!isDate(wfhFrom))
        return res.status(400).json({ success: false, message: "From date required" });
      if (wfhTo && !isDate(wfhTo))
        return res.status(400).json({ success: false, message: "Invalid To date" });
      if (wfhTo && wfhTo < wfhFrom)
        return res.status(400).json({ success: false, message: "To date cannot be before From date" });
      if (workMode === "hybrid" &&
          (!Array.isArray(wfhDays) || !wfhDays.length || wfhDays.some((d) => !DAYS.includes(d))))
        return res.status(400).json({ success: false, message: "Select the WFH days for hybrid mode" });
      if (!String(wfhReason).trim())
        return res.status(400).json({ success: false, message: "Reason required" });

      update = {
        workMode,
        wfhFrom,
        wfhTo: wfhTo || "",
        wfhDays: workMode === "hybrid" ? wfhDays : [],
        wfhReason: String(wfhReason).trim(),
        wfhApprovedBy: req.actor?.name || req.user?.name || "HR",
      };
    }

    const emp = await Employee.findByIdAndUpdate(req.params.employeeId, { $set: update }, { new: true })
      .select(FIELDS).lean();
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    // Innaikku already punch pannirundha, antha record mode ah um update pannu
    const today = todayIST();
    await Attendance.updateOne(
      { employee_id: emp._id, date: today },
      { $set: { work_mode: getEffectiveWorkMode(emp, today) } }
    );

    // Employee ku notification (push um auto-ah pogum)
    const label = workMode === "office" ? "Office" : workMode === "wfh" ? "Work From Home" : "Hybrid";
    await createNotification({
      recipient_id: String(emp._id),
      recipient_role: "employee",
      type: "attendance",
      title: "Work mode updated",
      message:
        workMode === "office"
          ? "Your work mode has been changed to Office."
          : `Your work mode is now ${label} (${wfhFrom}${wfhTo ? " to " + wfhTo : " onwards"}).`,
      link: "/employee/attendance",
    });

    res.json({ success: true, data: { ...emp, effectiveToday: getEffectiveWorkMode(emp, today) } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;