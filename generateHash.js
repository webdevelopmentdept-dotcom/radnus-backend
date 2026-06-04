const bcrypt = require("bcryptjs");

const empLoginPassword = "radnus@1234";
const empLoginHash = bcrypt.hashSync(empLoginPassword, 10);

console.log("EMP_LOGIN_PASSWORD=" + empLoginHash);