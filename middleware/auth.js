const jwt = require('jsonwebtoken');
const Employee = require('../models/Employee');

module.exports = async (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ message: 'UNAUTHORIZED' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Admin/HR tokens use fixed ids (e.g. "hr_admin_001"), not real Employee
    // documents — nothing to re-check for them, skip straight through.
    if (decoded.role === 'admin' || decoded.role === 'hr') {
      req.user = decoded;
      return next();
    }

    // Regular employee token — re-check status on every request so that
    // Deactivate Access / Fire / Relieve take effect immediately, even if
    // this employee already has a valid, not-yet-expired token.
    const emp = await Employee.findById(decoded.id).select('accessDeactivated exitType');
    if (!emp) {
      return res.status(401).json({ message: 'TOKEN_INVALID' });
    }
    if (emp.accessDeactivated || emp.exitType === 'relieved' || emp.exitType === 'fired') {
      return res.status(403).json({ message: 'ACCESS_DEACTIVATED' });
    }

    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: 'TOKEN_INVALID' });
  }
};