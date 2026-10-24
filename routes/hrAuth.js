const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();
const jwt = require("jsonwebtoken");
const HrStaff = require("../models/HrStaff");

router.post("/login", async (req, res) => {
  const { email, password } = req.body;


    // ✅ NEW: DB-based HR staff login (created by Admin).
  // Not found in DB → falls through to the old .env login below, untouched.
  try {
    const staff = await HrStaff.findOne({ email: String(email || "").toLowerCase().trim() });
    if (staff) {
      if (staff.status !== "active") {
        return res.status(403).json({ success: false, msg: "Your HR access is deactivated. Contact Admin." });
      }
      const ok = await bcrypt.compare(password || "", staff.password);
      if (!ok) return res.status(401).json({ success: false, msg: "Invalid password" });

      await HrStaff.updateOne({ _id: staff._id }, { lastLoginAt: new Date() });

      const token = jwt.sign(
        {
          id: "hr_admin_001",            // shared HR inbox id → notifications keep working
          role: "hr",
          email: staff.email,
          staffId: String(staff._id),    // real identity
          name: staff.name,
          staffRole: staff.staffRole,
        },
        process.env.JWT_SECRET,
        { expiresIn: "7d" }
      );
      return res.json({
        success: true,
        msg: "HR login successful",
        role: "hr",
        token,
        hr: {
          _id: "hr_admin_001",
          staffId: String(staff._id),
          name: staff.name,
          email: staff.email,
          role: "hr",
          staffRole: staff.staffRole,
        },
      });
    }
  } catch (err) {
    console.error("HrStaff login lookup failed, using legacy login:", err.message);
  }

    // ✅ NEW: Admin can also enter the HR panel using Admin credentials.
  // If password doesn't match, we just fall through (legacy HR check still runs).
  try {
    const adminEmail = process.env.ADMIN_EMAIL;
    const adminHash = (process.env.ADMIN_HASH_PASSWORD || "").trim();
    if (adminEmail && adminHash && email === adminEmail) {
      const ok = await bcrypt.compare(password || "", adminHash);
      if (ok) {
        const token = jwt.sign(
          {
            id: "hr_admin_001",     // shared HR inbox id (notifications keep working)
            role: "hr",
            email: adminEmail,
            actorId: "admin_001",   // real identity for tagging
            name: "Admin",
            staffRole: "admin",
          },
          process.env.JWT_SECRET,
          { expiresIn: "7d" }
        );
        return res.json({
          success: true,
          msg: "HR login successful",
          role: "hr",
          token,
          hr: { _id: "hr_admin_001", name: "Admin", email: adminEmail, role: "hr", staffRole: "admin" },
        });
      }
    }
  } catch (err) {
    console.error("Admin-in-HR login check failed:", err.message);
  }

  const hrEmail = process.env.HR_EMAIL;
  const hrHash = process.env.HR_HASH_PASSWORD;

  const empEmail = process.env.EMP_LOGIN_EMAIL;
  const empHash = process.env.EMP_LOGIN_PASSWORD;

  // ✅ HR Login Check
  if (email === hrEmail) {
    const match = await bcrypt.compare(password, hrHash);
    // if (match) {
    //   return res.json({
    //     success: true,
    //     msg: "HR login successful",
    //     role: "hr",
    //     hr: {
    //       _id: "hr_admin_001",
    //       email: hrEmail,
    //       role: "hr"
    //     }
    //   });
    // }
    if (match) {
  const token = jwt.sign(
    { id: "hr_admin_001", role: "hr", email: hrEmail },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
  return res.json({
    success: true,
    msg: "HR login successful",
    role: "hr",
    token,
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