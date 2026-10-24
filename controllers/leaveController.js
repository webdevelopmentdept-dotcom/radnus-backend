const LeaveRequest = require("../models/LeaveRequest");
const LeaveBalance = require("../models/LeaveBalance");
const HrLeaveType = require("../models/HrLeaveType");
const Attendance = require("../models/Attendance");
const Employee = require("../models/Employee");
const { createNotification } = require("../helpers/notificationHelper");
const KpiLeaderMapping = require("../models/KpiLeaderMapping");
const logAction = require("../helpers/logAction");

// ── POST /api/leave-requests ──────────────────────────────────────────────────
exports.createLeaveRequest = async (req, res) => {
  try {
    const { leave_type, from_date, to_date, reason, is_half_day, session } = req.body;

    // identity token-la irundhu, body-la irundhu illa
    const employee_id = req.user.id;

    if (!leave_type || !from_date || !to_date) {
      return res.status(400).json({
        success: false,
        message: "leave_type, from_date, to_date are required",
      });
    }

    const emp = await Employee.findById(employee_id).select("name department");
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
    const employee_name = emp.name;
    const department = emp.department;

    const existing = await LeaveRequest.findOne({
      employee_id,
      status: { $ne: "rejected" },
      from_date: { $lte: is_half_day ? from_date : to_date },
      to_date: { $gte: from_date },
    });
    if (existing) {
      return res.status(400).json({ success: false, message: "Leave request already exists for this period" });
    }

    // ── Routing: TL mapped-ah? ──
    const mapping = await KpiLeaderMapping.findOne({ isActive: true, member_ids: employee_id }).lean();
    const needsTL = !!mapping
      && String(mapping.leader_id) !== String(employee_id)
      && mapping.permissions?.leave_approval !== false;

    const leave = await LeaveRequest.create({
      employee_id, employee_name, department, leave_type, from_date,
      to_date: is_half_day ? from_date : to_date,
      reason: reason || "",
      is_half_day: is_half_day || false,
      session: is_half_day ? (session || "morning") : null,
      current_stage: needsTL ? "team_lead" : "hr",
      tl_approver_id: needsTL ? mapping.leader_id : null,
      tl_status: needsTL ? "pending" : "not_required",
    });

    if (needsTL) {
      await createNotification({
        recipient_id: String(mapping.leader_id),
        recipient_role: "employee",
        type: "leave_tl_review",
        title: `Leave Request — ${employee_name} 🌴`,
        message: `${employee_name} requested ${leave_type} from ${from_date} to ${to_date}. Please review.`,
        link: "/employee/team-leave",
      });
    } else {
      await createNotification({
        recipient_id: "hr_admin_001",
        recipient_role: "hr",
        type: "leave",
        title: `Leave Request — ${employee_name || "Employee"} 🌴`,
        message: `${employee_name || "An employee"} requested ${leave_type} from ${from_date} to ${to_date}.`,
        link: "/hr/dashboard/leave/requests",
      });
    }

    res.status(201).json({ success: true, message: "Leave request submitted", data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leave-requests/employee/:employeeId ──────────────────────────────
exports.getEmployeeLeaves = async (req, res) => {
  try {
    const isHr = ["hr", "admin"].includes(req.user.role);
    if (!isHr && String(req.params.employeeId) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
    const leaves = await LeaveRequest
      .find({ employee_id: req.params.employeeId })
      .populate("tl_approver_id", "name")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leave-requests (HR — all) ───────────────────────────────────────
exports.getAllLeaves = async (req, res) => {
  try {
    const leaves = await LeaveRequest
      .find()
      .populate("employee_id", "name employee_code department")
      .populate("tl_approver_id", "name")
      .sort({ createdAt: -1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/leave-requests/team-requests (Team Lead) ─────────────────────────
exports.getTeamLeaves = async (req, res) => {
  try {
    const leaves = await LeaveRequest
      .find({ tl_approver_id: req.user.id })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: leaves });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/leave-requests/:id/tl-approve | tl-reject ───────────────────────
const tlDecision = (decision) => async (req, res) => {
  try {
    if (decision === "rejected" && !(req.body.tl_remark || "").trim()) {
      return res.status(400).json({ success: false, message: "Reason is required to reject a leave" });
    }
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) return res.status(404).json({ success: false, message: "Leave not found" });

    if (String(leave.tl_approver_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Not your team member's leave" });
    }
    if (leave.current_stage !== "team_lead") {
      return res.status(400).json({ success: false, message: "Already reviewed" });
    }

    leave.tl_status = decision;               // "approved" | "rejected"
    leave.tl_remark = req.body.tl_remark || "";
    leave.tl_acted_at = new Date();
    leave.current_stage = "hr";                   // approve aanalum reject aanalum HR ku
    await leave.save();

    const tl = await Employee.findById(req.user.id).select("name");
    const tlName = tl?.name || "Team Lead";

    await createNotification({
      recipient_id: "hr_admin_001",
      recipient_role: "hr",
      type: "leave_tl_decision",
      title: `Leave ${decision === "approved" ? "recommended" : "not recommended"} by TL`,
      message: `${tlName} ${decision} ${leave.employee_name}'s ${leave.leave_type} (${leave.from_date} → ${leave.to_date}).`
        + (leave.tl_remark ? ` Remark: ${leave.tl_remark}` : ""),
      link: "/hr/dashboard/leave/requests",
    });

    await createNotification({
      recipient_id: String(leave.employee_id),
      recipient_role: "employee",
      type: "leave_tl_decision",
      title: `Team Lead ${decision} your leave`,
      message: `${tlName} ${decision} your ${leave.leave_type}. Now waiting for HR decision.`
        + (leave.tl_remark ? ` Remark: ${leave.tl_remark}` : ""),
      link: "/employee/attendance",
    });

    res.json({ success: true, message: `Sent to HR (TL ${decision})`, data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }

};
exports.tlApproveLeave = tlDecision("approved");
exports.tlRejectLeave = tlDecision("rejected");

// ── PUT /api/leave-requests/:id/approve ──────────────────────────────────────
exports.approveLeave = async (req, res) => {
  try {
    const current = await LeaveRequest.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: "Leave not found" });
    if (current.status === "approved") {
      return res.status(400).json({ success: false, message: "Already approved" });
    }
    if (current.current_stage === "team_lead") {
      return res.status(400).json({ success: false, message: "Waiting for Team Lead review" });
    }

    const leave = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: "approved",
          current_stage: "completed",
          hr_remark: req.body.hr_remark || "",
          approved_by: req.user?._id,   // idhai appadiye vidunga ("hr_admin_001" ObjectId cast aagaadhu)
          approved_by_name: req.actor?.name || "",                // NEW
          approved_by_staffId: String(req.actor?.id || ""),       // NEW
        },
      },
      { new: true }
    );
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave not found" });
    }

    // NEW: audit log (never throws, so it can't break the approval)
    await logAction(req, {
      action: "LEAVE_APPROVE",
      entityType: "LeaveRequest",
      entityId: leave._id,
      remarks: req.body.hr_remark || "",
      meta: { employee_id: leave.employee_id, leave_type: leave.leave_type },
    });

    const start = new Date(leave.from_date);
    const end = new Date(leave.to_date);
    const days = leave.is_half_day
      ? 0.5
      : Math.floor((end - start) / 86400000) + 1;

    await LeaveBalance.findOneAndUpdate(
      { employee_id: leave.employee_id },
      { $inc: { [`balances.${leave.leave_type}.used`]: days } },
      { upsert: true }
    );

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split("T")[0];
      await Attendance.findOneAndUpdate(
        { employee_id: leave.employee_id, date: dateStr },
        {
          $set: {
            employee_id: leave.employee_id,
            date: dateStr,
            status: leave.is_half_day ? "half_day" : "leave",
            method: "leave_request",  // "auto" → "leave_request"
            session: leave.is_half_day ? leave.session : null,
            leave_request_id: leave._id,  // trace பண்ண
            edited_by_name: req.actor?.name || "",
            edited_by_role: req.actor?.role || "",
            edited_at: new Date(),
          },
        },
        { upsert: true }
      );
    }

    await createNotification({
      recipient_id: leave.employee_id,
      recipient_role: "employee",
      type: "leave_approved",
      title: "Leave Approved ✅",
      message: `Your ${leave.leave_type} from ${leave.from_date} to ${leave.to_date} has been approved.`
        + (req.body.hr_remark ? ` HR note: ${req.body.hr_remark}` : ""),
      link: "/employee/attendance",
    });

    res.json({ success: true, message: "Leave approved", data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/leave-requests/:id/reject ───────────────────────────────────────
exports.rejectLeave = async (req, res) => {
  try {
    if (!(req.body.hr_remark || "").trim()) {
      return res.status(400).json({ success: false, message: "Reason is required to reject a leave" });
    }
    const current = await LeaveRequest.findById(req.params.id);
    if (!current) return res.status(404).json({ success: false, message: "Leave not found" });
    if (current.status === "approved") {
      return res.status(400).json({ success: false, message: "Approved leave can't be rejected" });
    }
    if (current.current_stage === "team_lead") {
      return res.status(400).json({ success: false, message: "Waiting for Team Lead review" });
    }

    const leave = await LeaveRequest.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: "rejected", current_stage: "completed", hr_remark: req.body.hr_remark || "", approved_by_name: req.actor?.name || "",
          approved_by_staffId: String(req.actor?.id || ""),
        }
      },
      { new: true }
    );
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave not found" });
    }

    await logAction(req, {
      action: "LEAVE_REJECT", entityType: "LeaveRequest", entityId: leave._id,
      remarks: req.body.hr_remark || "", meta: { employee_id: leave.employee_id },
    });

    await createNotification({
      recipient_id: leave.employee_id,
      recipient_role: "employee",
      type: "leave_rejected",
      title: "Leave Rejected ❌",
      message: `Your ${leave.leave_type} from ${leave.from_date} to ${leave.to_date} has been rejected.`
        + (req.body.hr_remark ? ` HR note: ${req.body.hr_remark}` : ""),
      link: "/employee/attendance",
    });

    res.json({ success: true, message: "Leave rejected", data: leave });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
// ── GET /api/leave-balance/:empId ────────────────────────────────────────────
exports.getLeaveBalance = async (req, res) => {
  try {
    const record = await LeaveBalance.findOne({ employee_id: req.params.empId });

    if (!record || !record.balances || record.balances.size === 0) {
      const leaveTypes = await HrLeaveType.find().lean();
      const data = {};
      leaveTypes.forEach((lt) => {
        data[lt.name] = lt.days_allowed ?? 0;
      });
      return res.json({ success: true, data });
    }

    const data = {};
    for (const [typeName, bal] of record.balances.entries()) {
      data[typeName] = Math.max(0, bal.total - bal.used);
    }

    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
// ── DELETE /api/leave-requests/:id (Employee cancel) ─────────────────────────
exports.cancelLeaveRequest = async (req, res) => {
  try {
    const leave = await LeaveRequest.findById(req.params.id);
    if (!leave) {
      return res.status(404).json({ success: false, message: "Leave not found" });
    }

    const isHr = ["hr", "admin"].includes(req.user.role);
    if (!isHr && String(leave.employee_id) !== String(req.user.id)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Approved leave-ஆ இருந்தாலும் delete பண்ண allow பண்ணு
    // Attendance records clean up பண்ணு
    if (leave.status === "approved") {
      const start = new Date(leave.from_date);
      const end = new Date(leave.to_date);
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        await Attendance.findOneAndDelete({
          employee_id: leave.employee_id,
          date: dateStr,
          method: "leave_request",
        });
      }
    }

    await LeaveRequest.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Leave request cancelled" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};