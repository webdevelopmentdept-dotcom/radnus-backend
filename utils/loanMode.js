const Employee = require("../models/Employee");

// mode = "bde" | "marketing" | undefined
// marketing -> Marketing department staff-oda customers mattum
// bde       -> Marketing illaadha ellaarum (existing BDE data maari)
async function buildModeFilter(mode) {
  if (mode !== "marketing" && mode !== "bde") return {};

  const mk = await Employee.find({
    department: { $regex: "marketing", $options: "i" },
  }).select("_id");
  const ids = mk.map((e) => e._id);

  return mode === "marketing"
    ? { staffId: { $in: ids } }
    : { staffId: { $nin: ids } };
}

module.exports = { buildModeFilter };