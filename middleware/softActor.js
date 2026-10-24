const jwt = require("jsonwebtoken");

module.exports = (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(" ")[1];
        if (token) {
            const d = jwt.verify(token, process.env.JWT_SECRET);
            if (d.role === "hr" || d.role === "admin") {
                req.actor = {
                    id: d.actorId || d.staffId || d.id,
                    name: d.name || (d.role === "admin" ? "Admin" : "HR Admin"),
                    role: d.staffRole || d.role,
                    email: d.email || "",
                    isTest: d.staffRole === "tester",      // NEW
                };
            }
        }
    } catch (e) { /* invalid/expired token → ignore, never block */ }
    next();
};