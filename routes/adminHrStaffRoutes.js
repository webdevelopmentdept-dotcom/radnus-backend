const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const HrStaff = require("../models/HrStaff");
const Employee = require("../models/Employee");
const router = express.Router();
const HR_DEPT_REGEX = /human\s*resources|\bhr\b/i;
const LOGIN_DOMAIN = "radnus.in";
const logAction = require("../helpers/logAction");

// hrradnus01@radnus.in, mdradnus01@radnus.in, hrtest01@radnus.in ...
async function nextLoginId(prefix = "hrradnus") {
    const re = new RegExp(`^${prefix}(\\d+)@`, "i");
    const rows = await HrStaff.find({ email: re }).select("email");
    let max = 0;
    rows.forEach((r) => {
        const m = r.email.match(re);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    });
    return `${prefix}${String(max + 1).padStart(2, "0")}@${LOGIN_DOMAIN}`;
}

// Admin-only guard (only for this router)
function requireAdmin(req, res, next) {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (!token) return res.status(401).json({ message: "UNAUTHORIZED" });
        const d = jwt.verify(token, process.env.JWT_SECRET);
        if (d.role !== "admin") return res.status(403).json({ message: "ADMIN_ONLY" });
        req.admin = d;
        next();
    } catch {
        res.status(401).json({ message: "TOKEN_INVALID" });
    }
}
router.use(requireAdmin);

// ELIGIBLE EMPLOYEES
//   ?role=hr (default) -> active employees in HR department
//   ?role=md           -> all active employees
// Employees who already have an HR login are excluded.
router.get("/eligible-employees", async (req, res) => {
    try {
        const role = req.query.role === "md" ? "md" : "hr";
        const taken = await HrStaff.find({ employeeId: { $ne: null } }).select("employeeId");
        const q = {
            status: "active",
            accessDeactivated: { $ne: true },
            _id: { $nin: taken.map((t) => t.employeeId) },
        };
        if (role === "hr") q.department = HR_DEPT_REGEX;

        const emps = await Employee.find(q)
            .select("name employeeId email department designation")
            .sort({ name: 1 });
        res.json({ success: true, data: emps });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

// LIST
router.get("/", async (req, res) => {
    try {
        const list = await HrStaff.find().select("-password").sort({ createdAt: -1 });
        res.json({ success: true, data: list });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

// CREATE (manual - kept for backward compatibility, not used by the UI)
router.post("/", async (req, res) => {
    try {
        const { name, email, password, staffRole } = req.body;
        if (!name || !email || !password || password.length < 6)
            return res.status(400).json({ success: false, msg: "name, email, password(min 6) required" });
        const exists = await HrStaff.findOne({ email: email.toLowerCase().trim() });
        if (exists) return res.status(409).json({ success: false, msg: "Email already exists" });

        const staff = await HrStaff.create({
            name,
            email,
            password: await bcrypt.hash(password, 10),
            staffRole: staffRole === "md" ? "md" : "hr",
            createdBy: req.admin.email || "admin",
        });
        const out = staff.toObject();
        delete out.password;
        res.status(201).json({ success: true, data: out });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

// CREATE FROM EMPLOYEE (HR -> must be in HR dept, MD -> any active employee)
router.post("/from-employee", async (req, res) => {
    try {
        const { employeeId, password, staffRole } = req.body;
        const role = staffRole === "md" ? "md" : "hr";
        if (!employeeId || !password || password.length < 6)
            return res.status(400).json({ success: false, msg: "employeeId and password (min 6) required" });

        const emp = await Employee.findById(employeeId);
        if (!emp || emp.status !== "active" || emp.accessDeactivated)
            return res.status(400).json({ success: false, msg: "Employee is not active" });
        if (role === "hr" && !HR_DEPT_REGEX.test(emp.department || ""))
            return res.status(400).json({ success: false, msg: "Employee is not in HR department" });
        if (await HrStaff.findOne({ employeeId: emp._id }))
            return res.status(409).json({ success: false, msg: "This employee already has an HR login" });

        const loginId = await nextLoginId(role === "md" ? "mdradnus" : "hrradnus");
        const staff = await HrStaff.create({
            name: emp.name,
            email: loginId,
            password: await bcrypt.hash(password, 10),
            staffRole: role,
            employeeId: emp._id,
            empCode: emp.employeeId || "",
            department: emp.department || "",
            createdBy: req.admin.email || "admin",
        });
        await logAction(req, {
            action: "HR_ACCOUNT_CREATE", entityType: "HrStaff", entityId: staff._id,
            entityName: staff.name, remarks: `${role} • ${loginId}`,
        });
        const out = staff.toObject();
        delete out.password;
        res.status(201).json({ success: true, data: out, loginId });
    } catch (e) {
        if (e.code === 11000)
            return res.status(409).json({ success: false, msg: "Login ID clash, please try again" });
        res.status(500).json({ success: false, msg: e.message });
    }
});

// SPECIAL ACCOUNT: standalone login with no employee link
//   staffRole "md"     -> MD account   (mdradnusNN@radnus.in, name required)
//   anything else      -> test / dev-team account (hrtestNN@radnus.in)
router.post("/special-account", async (req, res) => {
    try {
        const { password, name, staffRole } = req.body;
        const role = staffRole === "md" ? "md" : "tester";

        if (!password || password.length < 6)
            return res.status(400).json({ success: false, msg: "Password min 6 characters" });
        if (role === "md" && !(name || "").trim())
            return res.status(400).json({ success: false, msg: "MD name is required" });

        const loginId = await nextLoginId(role === "md" ? "mdradnus" : "hrtest");
        const staff = await HrStaff.create({
            name: (name || "").trim() || "Test HR (Dev Team)",
            email: loginId,
            password: await bcrypt.hash(password, 10),
            staffRole: role,
            department: role === "md" ? "Management" : "Development / Testing",
            createdBy: req.admin.email || "admin",
        });

        await logAction(req, {
            action: "HR_ACCOUNT_CREATE", entityType: "HrStaff", entityId: staff._id,
            entityName: staff.name, remarks: `${role} • ${loginId}`,
        });

        const out = staff.toObject();
        delete out.password;
        res.status(201).json({ success: true, data: out, loginId });
    } catch (e) {
        if (e.code === 11000)
            return res.status(409).json({ success: false, msg: "Login ID clash, try again" });
        res.status(500).json({ success: false, msg: e.message });
    }
});

router.patch("/:id", async (req, res) => {
  try {
    const { name, staffRole, status } = req.body;
    const upd = {};
    if (name) upd.name = name;
    if (["hr", "md"].includes(staffRole)) upd.staffRole = staffRole;
    if (["active", "inactive"].includes(status)) upd.status = status;

    const before = await HrStaff.findById(req.params.id).select("-password").lean();
    if (!before) return res.status(404).json({ success: false, msg: "Not found" });

    const s = await HrStaff.findByIdAndUpdate(req.params.id, upd, { new: true }).select("-password");

    const changes = Object.keys(upd).filter((k) => String(before[k]) !== String(upd[k]));
    if (changes.length) {
      const action = changes.includes("status")
        ? (upd.status === "inactive" ? "HR_ACCOUNT_DEACTIVATE" : "HR_ACCOUNT_ACTIVATE")
        : changes.includes("staffRole") ? "HR_ROLE_CHANGE" : "HR_ACCOUNT_UPDATE";
      await logAction(req, {
        action, entityType: "HrStaff", entityId: s._id, entityName: s.name,
        meta: {
          before: Object.fromEntries(changes.map((k) => [k, before[k]])),
          after:  Object.fromEntries(changes.map((k) => [k, upd[k]])),
        },
      });
    }
    res.json({ success: true, data: s });
  } catch (e) {
    res.status(500).json({ success: false, msg: e.message });
  }
});

// RESET PASSWORD
router.patch("/:id/password", async (req, res) => {
    try {
        const { password } = req.body;
        if (!password || password.length < 6)
            return res.status(400).json({ success: false, msg: "Password min 6 chars" });
        const s = await HrStaff.findByIdAndUpdate(req.params.id, {
            password: await bcrypt.hash(password, 10),
        });
        if (!s) return res.status(404).json({ success: false, msg: "Not found" });
        
        await logAction(req, { action: "HR_PASSWORD_RESET", entityType: "HrStaff", entityId: s._id, entityName: s.name });
        
        res.json({ success: true, msg: "Password updated" });
    } catch (e) {
        res.status(500).json({ success: false, msg: e.message });
    }
});

module.exports = router;