const express    = require("express");
const router     = express.Router();
const Department = require("../models/Department");
const Employee   = require("../models/Employee"); // your existing model
 
// ── GET all (with optional ?status=active filter) ──
router.get("/", async (req, res) => {
  try {
    const filter = req.query.status ? { status:req.query.status } : {};
    // Populate employee count via aggregation
    const depts = await Department.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "employees",        // your Employee collection name
          localField: "_id",
          foreignField: "department", // field in Employee that stores dept _id
          as: "employees",
        },
      },
      {
        $addFields: {
          employeeCount: {
            $size: {
              $filter: {
                input: "$employees",
                as: "emp",
                cond: { $eq: ["$$emp.status", "active"] },
              },
            },
          },
        },
      },
      { $project: { employees:0 } }, // remove the raw array
      { $sort: { name:1 } },
    ]);
    res.json({ success:true, data:depts });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});
 
// ── GET /active — slim list for dropdowns ──
router.get("/active", async (req, res) => {
  try {
    const depts = await Department.find({ status:"active" })
      .select("name code _id")
      .sort({ name:1 });
    res.json({ success:true, data:depts });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});
 
// ── GET /:id/employee-count — used before delete modal ──
router.get("/:id/employee-count", async (req, res) => {
  try {
    const count = await Employee.countDocuments({
      department: req.params.id,
      status: "active",
    });
    res.json({ success:true, count });
  } catch {
    res.json({ success:true, count:0 }); // safe fallback
  }
});
 
// ── POST — create ──
router.post("/", async (req, res) => {
  try {
    const { name, code, head, description, status } = req.body;
    if (!name || !code)
      return res.status(400).json({ success:false, message:"Name and Code are required" });
 
    const conflict = await Department.findOne({
      $or: [{ name:name.trim() }, { code:code.trim().toUpperCase() }],
    });
    if (conflict) {
      const field = conflict.name===name.trim() ? "name" : "code";
      return res.status(409).json({ success:false, message:`Department ${field} already exists` });
    }
 
    const dept = await Department.create({ name, code:code.toUpperCase(), head, description, status });
    res.status(201).json({ success:true, data:dept, message:"Department created" });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});
 
// ── PUT /:id — update ──
router.put("/:id", async (req, res) => {
  try {
    const { name, code, head, description, status } = req.body;
    const orConds = [];
    if (name) orConds.push({ name:name.trim() });
    if (code) orConds.push({ code:code.trim().toUpperCase() });
 
    if (orConds.length) {
      const conflict = await Department.findOne({ $or:orConds, _id:{ $ne:req.params.id } });
      if (conflict) {
        const field = conflict.name===name?.trim() ? "name" : "code";
        return res.status(409).json({ success:false, message:`Another department with this ${field} already exists` });
      }
    }
 
    const dept = await Department.findByIdAndUpdate(
      req.params.id,
      { name, code:code?.toUpperCase(), head, description, status },
      { new:true, runValidators:true }
    );
    if (!dept) return res.status(404).json({ success:false, message:"Not found" });
    res.json({ success:true, data:dept, message:"Department updated" });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});
 
// ── PATCH /:id/status — toggle active / inactive ──
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active","inactive"].includes(status))
      return res.status(400).json({ success:false, message:"Invalid status value" });
 
    const dept = await Department.findByIdAndUpdate(
      req.params.id, { status }, { new:true }
    );
    if (!dept) return res.status(404).json({ success:false, message:"Not found" });
    res.json({ success:true, data:dept, message:`Department marked ${status}` });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});
 
// ── DELETE /:id — permanent delete (no employee block, frontend already warned) ──
router.delete("/:id", async (req, res) => {
  try {
    const dept = await Department.findByIdAndDelete(req.params.id);
    if (!dept) return res.status(404).json({ success:false, message:"Not found" });
    res.json({ success:true, message:"Department deleted permanently" });
  } catch (err) {
    res.status(500).json({ success:false, message:err.message });
  }
});
 
module.exports = router;