const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const hrEmail = process.env.HR_EMAIL;
  const hrHash = process.env.HR_HASH_PASSWORD;

  const empEmail = process.env.EMP_LOGIN_EMAIL;
  const empHash = process.env.EMP_LOGIN_PASSWORD;

  // ✅ HR Login Check
  if (email === hrEmail) {
    const match = await bcrypt.compare(password, hrHash);
    if (match) {
      return res.json({
        success: true,
        msg: "HR login successful",
        role: "hr",
        hr: {
          _id: "hr_admin_001",
          email: hrEmail,
          role: "hr"
        }
      });
    }
    return res.status(401).json({ success: false, msg: "Invalid password" });
  }

  // ✅ Employee Login Check
  if (email === empEmail) {
    const match = await bcrypt.compare(password, empHash);
    if (match) {
      return res.json({
        success: true,
        msg: "Employee login successful",
        role: "employee",
        hr: {
          _id: "emp_001",
          email: empEmail,
          role: "employee"
        }
      });
    }
    return res.status(401).json({ success: false, msg: "Invalid password" });
  }

  return res.status(401).json({ success: false, msg: "Invalid credentials" });
});

module.exports = router;