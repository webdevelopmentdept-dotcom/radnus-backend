const { TrainingProgram, EmployeeTraining, ComplianceLog } = require("../models/TrainingRca");
const Employee = require("../models/Employee");

// ═══════════════════════════════════════════════════════════════
// TRAINING PROGRAM MASTER APIs (HR)
// ═══════════════════════════════════════════════════════════════

// ── GET /api/training/programs ────────────────────────────────
const getAllPrograms = async (req, res) => {
  try {
    const { level, department, type } = req.query;
    const filter = { isActive: true };
    if (level)      filter.level      = level;
    if (department) filter.department = department;
    if (type)       filter.type       = type;

    const programs = await TrainingProgram.find(filter).sort({ level: 1, type: 1 });
    res.json({ success: true, data: programs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/training/programs ───────────────────────────────
const createProgram = async (req, res) => {
  try {
    const program = await TrainingProgram.create(req.body);
    res.status(201).json({ success: true, data: program, message: "Training program created" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/programs/:id ────────────────────────────
const updateProgram = async (req, res) => {
  try {
    const program = await TrainingProgram.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!program) return res.status(404).json({ success: false, message: "Program not found" });
    res.json({ success: true, data: program, message: "Program updated" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DELETE /api/training/programs/:id ────────────────────────
const deleteProgram = async (req, res) => {
  try {
    await TrainingProgram.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ success: true, message: "Program deactivated" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/training/seed ───────────────────────────────────
// Seed default programs from Policy 3.15
const seedDefaultPrograms = async (req, res) => {
  try {
    const exists = await TrainingProgram.countDocuments();
    if (exists > 0) return res.json({ success: true, message: "Programs already seeded" });

    const defaults = [
      // Job-Role Based (L1-L6)
      { title:"Induction Training", level:"L1", type:"induction", modules:["Company Induction","Basic Communication Skills","Workplace Etiquette","Radnus Culture (The Radnus Way)"], duration:"7 Days", certification:"RCA Foundation Certificate", conductedBy:"HR & Culture", frequency:"on_joining", isMandatory:true },
      { title:"Executive Training", level:"L2", type:"job_role",  modules:["Product & Service Training","CRM & ERP Usage","Customer Handling / Complaint Management","Basic Reporting & Excel"], duration:"1 Month", certification:"RCA Role Certificate", conductedBy:"Dept. Head + Trainer", frequency:"on_joining", isMandatory:true },
      { title:"Senior Executive Training", level:"L3", type:"job_role", modules:["Advanced Product Knowledge","Department SOP Training","Team Coordination & Follow-up Systems","Basic Leadership Skills"], duration:"2 Months", certification:"RCA Performance Certificate", conductedBy:"L&D Team", frequency:"on_joining", isMandatory:true },
      { title:"Manager Training", level:"L4", type:"job_role", modules:["Strategic Planning & Target Setting","People Management Skills","Coaching & Mentoring","Business Review & Reporting"], duration:"3 Months", certification:"RCA Leadership Readiness Badge", conductedBy:"HR + L&D", frequency:"on_joining", isMandatory:true },
      { title:"GM / AVP Training", level:"L5", type:"job_role", modules:["Business Growth Strategy","Financial & Cost Awareness","Data-driven Decision Making","Leadership Communication"], duration:"3-6 Months", certification:"RCA Business Leadership Certificate", conductedBy:"CEO Office + External Faculty", frequency:"on_joining", isMandatory:true },
      { title:"VP / Director / CXO Training", level:"L6", type:"job_role", modules:["Vision Alignment & Strategy Execution","Corporate Governance & Risk Management","Digital Transformation","Cross-Functional Leadership"], duration:"6 Months", certification:"RCA Executive Leadership Certificate", conductedBy:"CEO + Advisory Board", frequency:"on_joining", isMandatory:true },

      // Training Frequency Types
      { title:"Job Role Training", level:"all", type:"job_role", modules:["Role-specific skills","SOP compliance","Tool proficiency"], duration:"Varies", frequency:"within_30_days", responsible:"Department Trainer", isMandatory:true },
      { title:"Cross-Functional / Leadership", level:"all", type:"cross_functional", modules:["Cross-team collaboration","Leadership fundamentals","Communication skills"], duration:"Varies", frequency:"half_yearly", responsible:"L&D + HR", isMandatory:false },
      { title:"Culture & Engagement Training", level:"all", type:"culture", modules:["Radnus culture","Engagement practices","Team bonding"], duration:"1 Day", frequency:"quarterly", responsible:"Culture Team", isMandatory:true },
      { title:"Refresher Training", level:"all", type:"refresher", modules:["Policy updates","Skill refresh","Compliance review"], duration:"Varies", frequency:"annual", responsible:"HR & L&D", isMandatory:true },

      // Department-wise
      { title:"Sales & Distribution Mandatory", level:"all", department:"Sales & Distribution", type:"department", modules:["Product Mastery","Negotiation Skills","Channel Management","CRM Usage","Customer Relationship Excellence"], duration:"1 Month", isMandatory:true },
      { title:"Technical & Service Mandatory",  level:"all", department:"Technical & Service",  type:"department", modules:["Product Repair Standards","Troubleshooting","Tools & ESD Handling","Quality Audits","RCV Model"], duration:"1 Month", isMandatory:true },
      { title:"HR & Admin Mandatory",           level:"all", department:"HR & Admin",           type:"department", modules:["HR Policies","Recruitment SOPs","Payroll Management","Employee Engagement","HRMS System"], duration:"1 Month", isMandatory:true },
      { title:"Accounts & Finance Mandatory",   level:"all", department:"Accounts & Finance",   type:"department", modules:["GST / Tally / Compliance","Expense Control","Profit Analysis","Cost Optimization","Audit Preparation"], duration:"1 Month", isMandatory:true },
      { title:"Marketing Mandatory",            level:"all", department:"Marketing",            type:"department", modules:["Digital Campaigns","Brand Guidelines","Market Analysis","Event Management","Customer Insights"], duration:"1 Month", isMandatory:true },
      { title:"Operations Mandatory",           level:"all", department:"Operations",           type:"department", modules:["Stock Management","Vendor Handling","Delivery Process","Process Optimization","MIS Reporting"], duration:"1 Month", isMandatory:true },
    ];

    await TrainingProgram.insertMany(defaults);
    res.json({ success: true, message: `${defaults.length} default programs seeded` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE TRAINING ASSIGNMENT APIs (HR)
// ═══════════════════════════════════════════════════════════════

// ── POST /api/training/assign ─────────────────────────────────
const assignTraining = async (req, res) => {
  try {
    const { employeeId, programId, dueDate, notes, addedBy } = req.body;
    if (!employeeId || !programId)
      return res.status(400).json({ success: false, message: "employeeId and programId required" });

    const emp  = await Employee.findById(employeeId);
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    const prog = await TrainingProgram.findById(programId);
    if (!prog) return res.status(404).json({ success: false, message: "Program not found" });

    // Check if already assigned
    const exists = await EmployeeTraining.findOne({ employeeId, programId, status: { $nin: ["completed","waived"] } });
    if (exists) return res.status(409).json({ success: false, message: "Already assigned and not yet completed" });

    const record = await EmployeeTraining.create({
      employeeId, programId,
      status: "pending",
      assignedDate: new Date(),
      dueDate: dueDate || null,
      notes: notes || "",
      addedBy: addedBy || "HR",
    });

    // Log compliance
    await ComplianceLog.create({
      employeeId, programId,
      programTitle: prog.title,
      action: "assigned",
      note: `Assigned to ${emp.name}`,
      addedBy: addedBy || "HR",
    });

    await record.populate(["employeeId","programId"]);
    res.status(201).json({ success: true, data: record, message: "Training assigned" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/training/assign-bulk ───────────────────────────
// Assign a program to multiple employees at once
const assignBulk = async (req, res) => {
  try {
    const { employeeIds, programId, dueDate, addedBy } = req.body;
    if (!employeeIds?.length || !programId)
      return res.status(400).json({ success: false, message: "employeeIds[] and programId required" });

    const prog = await TrainingProgram.findById(programId);
    if (!prog) return res.status(404).json({ success: false, message: "Program not found" });

    const results = { assigned: [], skipped: [] };

    for (const empId of employeeIds) {
      const exists = await EmployeeTraining.findOne({ employeeId: empId, programId, status: { $nin: ["completed","waived"] } });
      if (exists) { results.skipped.push(empId); continue; }

      await EmployeeTraining.create({ employeeId: empId, programId, dueDate: dueDate || null, addedBy: addedBy || "HR" });
      await ComplianceLog.create({ employeeId: empId, programId, programTitle: prog.title, action: "assigned", addedBy: addedBy || "HR" });
      results.assigned.push(empId);
    }

    res.json({ success: true, data: results, message: `Assigned to ${results.assigned.length}, skipped ${results.skipped.length}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/training/records ─────────────────────────────────
// HR: all training records with filters
const getAllRecords = async (req, res) => {
  try {
    const { employeeId, programId, status, department } = req.query;
    const filter = {};
    if (employeeId) filter.employeeId = employeeId;
    if (programId)  filter.programId  = programId;
    if (status)     filter.status     = status;

    let records = await EmployeeTraining.find(filter)
      .populate("employeeId", "name department designation level")
      .populate("programId")
      .sort({ assignedDate: -1 });

    // Filter by department
    if (department) {
      records = records.filter(r => r.employeeId?.department === department);
    }

    res.json({ success: true, data: records, total: records.length });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/training/stats ───────────────────────────────────
const getStats = async (req, res) => {
  try {
    const total       = await EmployeeTraining.countDocuments();
    const completed   = await EmployeeTraining.countDocuments({ status: "completed" });
    const pending     = await EmployeeTraining.countDocuments({ status: "pending" });
    const inProgress  = await EmployeeTraining.countDocuments({ status: "in_progress" });
    const overdue     = await EmployeeTraining.countDocuments({ status: "overdue" });
    const certified   = await EmployeeTraining.countDocuments({ certificationIssued: true });

    // Avg assessment score
    const scored = await EmployeeTraining.find({ assessmentScore: { $ne: null } });
    const avgScore = scored.length
      ? Math.round(scored.reduce((a, r) => a + r.assessmentScore, 0) / scored.length)
      : 0;

    // Completion rate
    const completionRate = total > 0 ? Math.round((completed / total) * 100) : 0;

    // By department
    const byDept = await EmployeeTraining.aggregate([
      { $lookup: { from: "employees", localField: "employeeId", foreignField: "_id", as: "emp" } },
      { $unwind: "$emp" },
      { $group: { _id: "$emp.department", total: { $sum: 1 }, completed: { $sum: { $cond: [{ $eq: ["$status","completed"] }, 1, 0] } } } },
      { $sort: { total: -1 } },
    ]);

    res.json({
      success: true,
      data: { total, completed, pending, inProgress, overdue, certified, avgScore, completionRate, byDept },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/records/:id ────────────────────────────
// Update status, score, certification
const updateRecord = async (req, res) => {
  try {
    const { status, assessmentScore, certificationIssued, notes, addedBy, progressNote } = req.body;

    const record = await EmployeeTraining.findById(req.params.id).populate("programId");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const updateFields = {};
    if (status !== undefined) {
      updateFields.status = status;
      if (status === "in_progress" && !record.startedDate) updateFields.startedDate = new Date();
      if (status === "completed") updateFields.completedDate = new Date();
      if (status === "overdue" && !record.startedDate) updateFields.startedDate = null;
    }
    if (assessmentScore !== undefined) updateFields.assessmentScore = assessmentScore;
    if (certificationIssued !== undefined) {
      updateFields.certificationIssued = certificationIssued;
      if (certificationIssued) updateFields.certificationDate = new Date();
    }
    if (notes) updateFields.notes = notes;

    // Add progress note
    if (progressNote) {
      updateFields.$push = { progressLog: { note: progressNote, addedBy: addedBy || "HR" } };
    }

    const updated = await EmployeeTraining.findByIdAndUpdate(req.params.id, updateFields, { new: true })
      .populate("employeeId", "name department designation")
      .populate("programId");

    // Compliance log
    if (status) {
      await ComplianceLog.create({
        employeeId: record.employeeId,
        programId:  record.programId?._id,
        programTitle: record.programId?.title || "",
        action: status === "completed" ? "completed" : status === "in_progress" ? "started" : status,
        note: notes || progressNote || "",
        addedBy: addedBy || "HR",
      });
    }
    if (assessmentScore !== undefined) {
      await ComplianceLog.create({
        employeeId: record.employeeId,
        programId:  record.programId?._id,
        programTitle: record.programId?.title || "",
        action: "score_updated",
        note: `Score: ${assessmentScore}%`,
        addedBy: addedBy || "HR",
      });
    }

    res.json({ success: true, data: updated, message: "Training record updated" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/training/compliance-log ─────────────────────────
const getComplianceLog = async (req, res) => {
  try {
    const { employeeId, limit = 50 } = req.query;
    const filter = {};
    if (employeeId) filter.employeeId = employeeId;

    const logs = await ComplianceLog.find(filter)
      .populate("employeeId", "name department")
      .sort({ date: -1 })
      .limit(parseInt(limit));
    res.json({ success: true, data: logs });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE APIs
// ═══════════════════════════════════════════════════════════════

// ── GET /api/training/my/:employeeId ─────────────────────────
const getMyTrainings = async (req, res) => {
  try {
    const records = await EmployeeTraining.find({ employeeId: req.params.employeeId })
      .populate("programId")
      .sort({ assignedDate: -1 });

    const stats = {
      total:     records.length,
      completed: records.filter(r => r.status === "completed").length,
      pending:   records.filter(r => r.status === "pending").length,
      inProgress:records.filter(r => r.status === "in_progress").length,
      overdue:   records.filter(r => r.status === "overdue").length,
      certified: records.filter(r => r.certificationIssued).length,
    };

    res.json({ success: true, data: records, stats });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/my/:recordId/start ─────────────────────
const markStarted = async (req, res) => {
  try {
    const record = await EmployeeTraining.findByIdAndUpdate(
      req.params.recordId,
      { status: "in_progress", startedDate: new Date() },
      { new: true }
    ).populate("programId");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    await ComplianceLog.create({
      employeeId: record.employeeId,
      programId:  record.programId?._id,
      programTitle: record.programId?.title || "",
      action: "started",
      addedBy: "Employee",
    });

    res.json({ success: true, data: record, message: "Training started!" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

module.exports = {
  getAllPrograms, createProgram, updateProgram, deleteProgram, seedDefaultPrograms,
  assignTraining, assignBulk, getAllRecords, getStats, updateRecord, getComplianceLog,
  getMyTrainings, markStarted,
};