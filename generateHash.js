const bcrypt = require("bcryptjs");

const adminPassword = "sundar"; // example: "admin123"
const employeePassword = "radnus@2003"; // example: "emp123"

const adminHash = bcrypt.hashSync(adminPassword, 10);
const employeeHash = bcrypt.hashSync(employeePassword, 10);

console.log("ADMIN_HASH_PASSWORD=" + adminHash);
console.log("EMPLOYEE_PASSWORD=" + employeeHash);