const express    = require("express");
const router     = express.Router();
const Department = require("../models/Department");
const Employee   = require("../models/Employee");

// ── GET all ──
router.get("/", async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const depts = await Department.aggregate([
      { $match: filter },
      {
        $lookup: {
          from: "employees",
          localField: "_id",
          foreignField: "department",
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
      { $project: { employees: 0 } },
      { $sort: { name: 1 } },
    ]);
    res.json({ success: true, data: depts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /active — slim list for dropdowns ──
router.get("/active", async (req, res) => {
  try {
    const depts = await Department.find({ status: "active" })
      .select("name code _id designations")
      .sort({ name: 1 });
    res.json({ success: true, data: depts });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /:id/employee-count ──
router.get("/:id/employee-count", async (req, res) => {
  try {
    const count = await Employee.countDocuments({
      department: req.params.id,
      status: "active",
    });
    res.json({ success: true, count });
  } catch {
    res.json({ success: true, count: 0 });
  }
});

// ── POST — create department ──
router.post("/", async (req, res) => {
  try {
    const { name, code, head, description, status, designations } = req.body;
    if (!name || !code)
      return res.status(400).json({ success: false, message: "Name and Code are required" });

    const conflict = await Department.findOne({
      $or: [{ name: name.trim() }, { code: code.trim().toUpperCase() }],
    });
    if (conflict) {
      const field = conflict.name === name.trim() ? "name" : "code";
      return res.status(409).json({ success: false, message: `Department ${field} already exists` });
    }

    const dept = await Department.create({
      name, code: code.toUpperCase(), head, description, status,
      designations: designations || [],
    });
    res.status(201).json({ success: true, data: dept, message: "Department created" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /:id — update department ──
router.put("/:id", async (req, res) => {
  try {
    const { name, code, head, description, status } = req.body;
    const orConds = [];
    if (name) orConds.push({ name: name.trim() });
    if (code) orConds.push({ code: code.trim().toUpperCase() });

    if (orConds.length) {
      const conflict = await Department.findOne({ $or: orConds, _id: { $ne: req.params.id } });
      if (conflict) {
        const field = conflict.name === name?.trim() ? "name" : "code";
        return res.status(409).json({ success: false, message: `Another department with this ${field} already exists` });
      }
    }

    const dept = await Department.findByIdAndUpdate(
      req.params.id,
      { name, code: code?.toUpperCase(), head, description, status },
      { new: true, runValidators: true }
    );
    if (!dept) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: dept, message: "Department updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PATCH /:id/status ──
router.patch("/:id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!["active", "inactive"].includes(status))
      return res.status(400).json({ success: false, message: "Invalid status value" });

    const dept = await Department.findByIdAndUpdate(
      req.params.id, { status }, { new: true }
    );
    if (!dept) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: dept, message: `Department marked ${status}` });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /:id ──
router.delete("/:id", async (req, res) => {
  try {
    const dept = await Department.findByIdAndDelete(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, message: "Department deleted permanently" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ══════════════════════════════════════════════════════
//  DESIGNATION ROUTES  (nested under department)
// ══════════════════════════════════════════════════════

// ── POST /:id/designations — add designation ──
router.post("/:id/designations", async (req, res) => {
  try {
    const { title, level, status } = req.body;
    if (!title)
      return res.status(400).json({ success: false, message: "Title is required" });

    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: "Department not found" });

    // Duplicate title check within same department
    const exists = dept.designations.some(
      d => d.title.toLowerCase() === title.trim().toLowerCase()
    );
    if (exists)
      return res.status(409).json({ success: false, message: "Designation title already exists in this department" });

    dept.designations.push({ title: title.trim(), level, status });
    await dept.save();

    res.status(201).json({ success: true, data: dept, message: "Designation added" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /:id/designations/replace-all — used when editing dept from modal ──
router.put("/:id/designations/replace-all", async (req, res) => {
  try {
    const { designations } = req.body;
    const dept = await Department.findByIdAndUpdate(
      req.params.id,
      { designations: designations || [] },
      { new: true, runValidators: true }
    );
    if (!dept) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: dept, message: "Designations updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /:id/designations/:desigId — update designation ──
router.put("/:id/designations/:desigId", async (req, res) => {
  try {
    const { title, level, status } = req.body;
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: "Department not found" });

    const desig = dept.designations.id(req.params.desigId);
    if (!desig) return res.status(404).json({ success: false, message: "Designation not found" });

    // Duplicate check (exclude self)
    if (title) {
      const exists = dept.designations.some(
        d => d._id.toString() !== req.params.desigId &&
             d.title.toLowerCase() === title.trim().toLowerCase()
      );
      if (exists)
        return res.status(409).json({ success: false, message: "Designation title already exists in this department" });
      desig.title = title.trim();
    }
    if (level)  desig.level  = level;
    if (status) desig.status = status;

    await dept.save();
    res.json({ success: true, data: dept, message: "Designation updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /:id/designations/:desigId ──
router.delete("/:id/designations/:desigId", async (req, res) => {
  try {
    const dept = await Department.findById(req.params.id);
    if (!dept) return res.status(404).json({ success: false, message: "Department not found" });

    dept.designations = dept.designations.filter(
      d => d._id.toString() !== req.params.desigId
    );
    await dept.save();
    res.json({ success: true, data: dept, message: "Designation deleted" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;