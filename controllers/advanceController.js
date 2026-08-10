// controllers/advanceController.js
const Advance  = require("../models/Advance");
const Employee = require("../models/Employee");
const { createNotification } = require("../helpers/notificationHelper");

// ── POST /api/advance/request ──────────────────────────────────────
// Employee (or HR on an employee's behalf) requests a salary advance.
// body: { employee_id, amount, reason, requested_by? }
exports.requestAdvance = async (req, res) => {
  try {
    const { employee_id, amount, reason, requested_by } = req.body;

    if (!employee_id || !amount || !reason || !String(reason).trim()) {
      return res.status(400).json({
        success: false,
        message: "employee_id, amount and reason are all required",
      });
    }
    if (Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: "Amount must be greater than 0" });
    }

    const emp = await Employee.findById(employee_id).lean();
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });
const advance = await Advance.create({
      employee_id,
      employee_name: emp.name,
      department: emp.department,
      amount: Number(amount),
      reason: String(reason).trim(),
      requested_by: requested_by === "hr" ? "hr" : "employee",
      status: "pending",
    });

    // ── Notify HR of the new advance request ──────────────────────
    await createNotification({
      recipient_id:   "hr_admin_001",
      recipient_role: "hr",
      type:           "employee",
      title:          `Advance Request — ${emp.name} 💰`,
      message:        `${emp.name} requested an advance of ₹${Number(amount).toLocaleString("en-IN")}. Reason: ${String(reason).trim()}`,
      link:           "/hr/dashboard/payroll/advances",
    });

    res.json({ success: true, message: "Advance request submitted", data: advance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/advance/employee/:employeeId ──────────────────────────
// Employee self-service: view own advance requests (all statuses)
exports.getEmployeeAdvances = async (req, res) => {
  try {
    const advances = await Advance.find({ employee_id: req.params.employeeId })
      .sort({ createdAt: -1 });
    res.json({ success: true, data: advances });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/advance/all?status=pending ────────────────────────────
// HR: list all advance requests, optionally filtered by status
exports.getAllAdvances = async (req, res) => {
  try {
    const filter = {};
    if (req.query.status) filter.status = req.query.status;
    const advances = await Advance.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, data: advances });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/advance/:id/approve ───────────────────────────────────
// HR approves the advance and decides amount to deduct on which month.
// body: { approved_by, amount?, recovery_month?, recovery_year?, hr_remarks? }
exports.approveAdvance = async (req, res) => {
  try {
    const { approved_by, amount, recovery_month, recovery_year, hr_remarks } = req.body;

    const advance = await Advance.findById(req.params.id);
    if (!advance) return res.status(404).json({ success: false, message: "Advance request not found" });
    if (advance.status !== "pending") {
      return res.status(400).json({ success: false, message: `This request is already ${advance.status}` });
    }

    const today = new Date();

    if (amount !== undefined && amount !== null && amount !== "") {
      if (Number(amount) <= 0) {
        return res.status(400).json({ success: false, message: "Amount must be greater than 0" });
      }
      advance.amount = Number(amount);
    }

    advance.status = "approved";
    advance.approved_by = approved_by || "";
    advance.approved_at = today;
    advance.hr_remarks = hr_remarks || "";
    // Which month's salary this advance gets deducted from — default: current month
    advance.recovery_month = recovery_month ? Number(recovery_month) : today.getMonth() + 1;
    advance.recovery_year  = recovery_year  ? Number(recovery_year)  : today.getFullYear();

   await advance.save();

    // ── Notify the employee that their advance request was approved ──
    await createNotification({
      recipient_id:   String(advance.employee_id),
      recipient_role: "employee",
      type:           "salary",
      title:          "Advance Approved ✅",
      message:        `Your advance request of ₹${Number(advance.amount).toLocaleString("en-IN")} has been approved.`
                    + (hr_remarks ? ` HR note: ${hr_remarks}` : "")
                    + ` It will be deducted from your ${advance.recovery_month}/${advance.recovery_year} salary.`,
      link:           "/employee/my-advance",
    });

    res.json({ success: true, message: "Advance approved", data: advance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/advance/:id/reject ─────────────────────────────────────
// body: { approved_by, hr_remarks }
exports.rejectAdvance = async (req, res) => {
  try {
    const { approved_by, hr_remarks } = req.body;

    const advance = await Advance.findById(req.params.id);
    if (!advance) return res.status(404).json({ success: false, message: "Advance request not found" });
    if (advance.status !== "pending") {
      return res.status(400).json({ success: false, message: `This request is already ${advance.status}` });
    }

    advance.status = "rejected";
    advance.approved_by = approved_by || "";
    advance.rejected_at = new Date();
    advance.hr_remarks = hr_remarks || "";
    await advance.save();

    // ── Notify the employee that their advance request was rejected ──
    await createNotification({
      recipient_id:   String(advance.employee_id),
      recipient_role: "employee",
      type:           "salary",
      title:          "Advance Rejected ❌",
      message:        `Your advance request of ₹${Number(advance.amount).toLocaleString("en-IN")} has been rejected.`
                    + (hr_remarks ? ` HR note: ${hr_remarks}` : ""),
      link:           "/employee/my-advance",
    });

    res.json({ success: true, message: "Advance request rejected", data: advance });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /api/advance/:id ─────────────────────────────────────────
// Only a still-pending request can be withdrawn/deleted.
exports.deleteAdvance = async (req, res) => {
  try {
    const advance = await Advance.findById(req.params.id);
    if (!advance) return res.status(404).json({ success: false, message: "Advance request not found" });
    if (advance.status !== "pending") {
      return res.status(400).json({ success: false, message: "Only a pending request can be withdrawn" });
    }
    await advance.deleteOne();
    res.json({ success: true, message: "Advance request withdrawn" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};