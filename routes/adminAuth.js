const express = require("express");
const bcrypt = require("bcryptjs");
const router = express.Router();

router.post("/login", (req, res) => {
  const { email, password } = req.body;

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminHash = (process.env.ADMIN_HASH_PASSWORD || "").trim();

  const employeeEmail = process.env.EMPLOYEE_EMAIL;
  const employeeHash = (process.env.EMPLOYEE_PASSWORD || "").trim();

  if (!adminEmail || !adminHash || !employeeEmail || !employeeHash) {
    return res.status(500).json({ success: false, msg: "Server credentials not configured" });
  }

  // ✅ Admin check
  if (email === adminEmail && bcrypt.compareSync(password, adminHash)) {
    return res.json({ success: true, role: "admin", msg: "Admin login successful!" });
  }

  // ✅ Employee check
  if (email === employeeEmail && bcrypt.compareSync(password, employeeHash)) {
    return res.json({ success: true, role: "employee", msg: "Employee login successful!" });
  }

  return res.status(401).json({ success: false, msg: "Invalid credentials" });
});

module.exports = router;