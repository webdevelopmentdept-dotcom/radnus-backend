// middleware/selfOrHr.js
// auth middleware ku APPURAM use pannanum
module.exports = (req, res, next) => {
  const user = req.user;
  if (!user) return res.status(401).json({ message: "UNAUTHORIZED" });

  // HR / Admin → ethuvum pannalam
  if (["hr", "admin"].includes(user.role)) return next();

  // Employee → own id mattum
  const myId = String(user.id || "");
  if (!myId) return res.status(401).json({ message: "UNAUTHORIZED" });

  if (req.params.employeeId && String(req.params.employeeId) !== myId) {
    return res.status(403).json({ success: false, message: "NOT_YOUR_RECORD" });
  }

  if (req.method === "POST") {
    if (req.body?.employee_id && String(req.body.employee_id) !== myId) {
      return res.status(403).json({ success: false, message: "NOT_YOUR_RECORD" });
    }
    req.body = req.body || {};
    req.body.employee_id = myId; // body la illa naalum token id vachi set
  }
  next();
};