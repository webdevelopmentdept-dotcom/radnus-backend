const Employee = require("../models/Employee");

// Must run AFTER auth.js — needs req.user already decoded from the JWT.
module.exports = async (req, res, next) => {
  try {
    // HR (static login, role: "hr" in the JWT) always has full access.
    if (req.user?.role === "hr") return next();

    // Employee JWT payload is just { id: user._id } — no role field.
    const employee = await Employee.findById(req.user?.id).select("canManageProducts");
    if (!employee || !employee.canManageProducts) {
      return res.status(403).json({ success: false, message: "You don't have access to Product Management" });
    }
    next();
  } catch (err) {
    res.status(500).json({ success: false, message: "Access check failed" });
  }
};