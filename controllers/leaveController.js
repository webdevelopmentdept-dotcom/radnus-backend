const LeaveRequest = require("../models/LeaveRequest");
const Attendance   = require("../models/Attendance");
const Employee     = require("../models/Employee");
const { createNotification } = require("../helpers/notificationHelper");

// ── POST /api/leave-requests ────────────────────────────────
exports.createLeaveRequest = async (req, res) => {
  try {
    const { employee_id, employee_name, department, leave_type, from_date, to_date, reason } = req.body;

    if (!employee_id || !leave_type || !from_date || !to_date || !reason) {
      return res.status(400).json({ success: false, message: "All fields required" });
    }

    // Duplicate check
    const existing = await LeaveRequest.findOne({
      employee_id,
      status:    { $ne: "rejected" },
      from_date: { $lte: to_date },
      to_date:   { $gte: from_date },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "Leave request already exists for this period" });
    }

    const leave = await LeaveRequest.create({
      employee_id, employee_name, department,
      leave_type, from_date, to_date, reason,
    });

    // ✅ Notify HR about new leave request
    const hrUsers = await Employee.find({ role: "hr" }).lean();
    for (const hr of hrUsers) {
      await createNotification({
        recipient_id:   hr._id,
        recipient_role: "hr",
        type:           "leave",
        title:          `Leave Request — ${employee_name || "Employee"} 🌴`,
        message:        `${employee_name || "An employee"} requested ${leave_type} from ${from_date} to ${to_date}.`,
        link:           "/hr/dashboard/leave/requests"
      });
    }

    res.status(201).json({ success: true, message: "Leave request submitted", data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leave-requests/employee/:employeeId ────────────
exports.getEmployeeLeaves = async (req, res) => {
  try {
    const leaves = await LeaveRequest.find({ employee_id: req.params.employeeId })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leave-requests (HR - all) ──────────────────────
exports.getAllLeaves = async (req, res) => {
  try {
    const leaves = await LeaveRequest.find()
      .populate("employee_id", "name employee_code department")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/leave-requests/:id/approve ─────────────────────
exports.approveLeave = async (req, res) => {
  try {
    const leave = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "approved", hr_remark: req.body.hr_remark || "", approved_by: req.user?._id } },
      { new: true }
    );
    if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });

    // Auto-mark attendance as "leave" for each day in range
    const start = new Date(leave.from_date);
    const end   = new Date(leave.to_date);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      await Attendance.findOneAndUpdate(
        { employee_id: leave.employee_id, date: dateStr },
        { $set: { employee_id: leave.employee_id, date: dateStr, status: "leave", method: "auto" } },
        { upsert: true }
      );
    }

    // ✅ Notify employee — leave approved
    await createNotification({
      recipient_id:   leave.employee_id,
      recipient_role: "employee",
      type:           "leave_approved",
      title:          "Leave Approved ✅",
      message:        `Your ${leave.leave_type} from ${leave.from_date} to ${leave.to_date} has been approved.${req.body.hr_remark ? ` HR note: ${req.body.hr_remark}` : ""}`,
      link:           "/employee/attendance"
    });

    res.json({ success: true, message: "Leave approved", data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/leave-requests/:id/reject ──────────────────────
exports.rejectLeave = async (req, res) => {
  try {
    const leave = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "rejected", hr_remark: req.body.hr_remark || "" } },
      { new: true }
    );
    if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });

    // ✅ Notify employee — leave rejected
    await createNotification({
      recipient_id:   leave.employee_id,
      recipient_role: "employee",
      type:           "leave_rejected",
      title:          "Leave Rejected ❌",
      message:        `Your ${leave.leave_type} from ${leave.from_date} to ${leave.to_date} has been rejected.${req.body.hr_remark ? ` HR note: ${req.body.hr_remark}` : ""}`,
      link:           "/employee/attendance"
    });

    res.json({ success: true, message: "Leave rejected", data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};