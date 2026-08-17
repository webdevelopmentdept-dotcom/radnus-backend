const { TrainingProgram, EmployeeTraining, ComplianceLog, QuizQuestion } = require("../models/TrainingRca");
const Employee = require("../models/Employee");
const Product = require("../models/Product");

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

// ── DELETE /api/training/programs — wipe ALL programs ─────────
// One-time cleanup so the roadmap only ever shows programs HR
// actually creates (replaces the old dummy-data seed button).
const deleteAllPrograms = async (req, res) => {
  try {
    const result = await TrainingProgram.deleteMany({});
    // Every product's trainingProgramId now points at a deleted document —
    // clear it so it reads as "unlinked" everywhere (list badge, backfill
    // query) instead of a dangling ObjectId that silently fails populate().
    await Product.updateMany({}, { trainingProgramId: null });
    res.json({ success: true, message: `${result.deletedCount} programs permanently deleted` });
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

// ── One shared "Equipment Training" program every product links to ──
// (was: a brand-new TrainingProgram per product). Looked up by
// isShared:true so there's ever only one such document.
const getOrCreateSharedEquipmentProgram = async () => {
  let program = await TrainingProgram.findOne({ type: "equipment", isShared: true });
  if (!program) {
    program = await TrainingProgram.create({
      title: "Equipment Training — All Products",
      type: "equipment",
      isShared: true,
      modules: ["KNOW", "OPERATE", "SERVICE", "TRAIN"],
      conductedBy: "L&D / Trainer",
      isMandatory: false,
    });
  }
  return program;
};

// ── POST /api/training/consolidate-equipment ────────────────────
// One-time migration: merges every existing per-product "equipment"
// program into the single shared one, re-points affected products AND
// their existing EmployeeTraining/assignment records so nothing is
// lost, then removes the now-redundant per-product programs.
const consolidateEquipmentPrograms = async (req, res) => {
  try {
    const shared = await getOrCreateSharedEquipmentProgram();

    // Every OTHER equipment program (per-product, pre-migration ones).
    const oldPrograms = await TrainingProgram.find({
      type: "equipment",
      _id: { $ne: shared._id },
    });

    let productsRelinked = 0;
    let recordsRelinked = 0;

    for (const old of oldPrograms) {
      const productResult = await Product.updateMany(
        { trainingProgramId: old._id },
        { trainingProgramId: shared._id }
      );
      productsRelinked += productResult.modifiedCount;

      const recordResult = await EmployeeTraining.updateMany(
        { programId: old._id },
        { programId: shared._id }
      );
      recordsRelinked += recordResult.modifiedCount;
    }

    // Also catch any product still pointing at nothing/dangling — same
    // dangling-reference case backfillEquipmentPrograms guards against.
    const allProducts = await Product.find({});
    let productsLinked = 0;
    for (const product of allProducts) {
      let needsLink = !product.trainingProgramId;
      if (!needsLink) {
        const stillExists = await TrainingProgram.exists({ _id: product.trainingProgramId });
        needsLink = !stillExists;
      }
      if (!needsLink) continue;
      product.trainingProgramId = shared._id;
      await product.save();
      productsLinked++;
    }

    const oldIds = oldPrograms.map(p => p._id);
    const deleteResult = oldIds.length ? await TrainingProgram.deleteMany({ _id: { $in: oldIds } }) : { deletedCount: 0 };

    res.json({
      success: true,
      message: `Merged ${deleteResult.deletedCount} per-product programs into 1 shared program. ${productsRelinked + productsLinked} products and ${recordsRelinked} training records re-linked.`,
      data: shared,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};


const backfillEquipmentPrograms = async (req, res) => {
  try {
    const shared = await getOrCreateSharedEquipmentProgram();
    const allProducts = await Product.find({});
    let linked = 0;
    for (const product of allProducts) {
      // Needs linking if trainingProgramId is empty, OR it still points
      // at an ID whose TrainingProgram document no longer exists (e.g.
      // products left over from before deleteAllPrograms started clearing
      // this field on wipe).
      let needsLink = !product.trainingProgramId;
      if (!needsLink) {
        const stillExists = await TrainingProgram.exists({ _id: product.trainingProgramId });
        needsLink = !stillExists;
      }
      if (!needsLink) continue;

      product.trainingProgramId = shared._id;
      await product.save();
      linked++;
    }
    res.json({ success: true, message: `${linked} products linked to the shared equipment program` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/training/programs/:id/products ─────────────────────
// Products linked to this program (Product.trainingProgramId === :id).
// Employee-facing "View Details" for a training card needs to show
// which real products an "equipment" program actually covers, plus
// each product's SOP/video/procedure — this is intentionally open
// (no canManageProducts gate) since it's read-only training content,
// not the full Product Management admin surface.
const getProgramProducts = async (req, res) => {
  try {
    const products = await Product.find({ trainingProgramId: req.params.id })
      .select("productName productCode category skillLevel images trainingVideoUrl operatingProcedure safetyInstructions applications sopId")
      .populate("sopId")
      .sort({ productName: 1 });
    res.json({ success: true, data: products });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};



// ═══════════════════════════════════════════════════════════════
// QUIZ QUESTION BANK (HR authors MCQs per product)
// ═══════════════════════════════════════════════════════════════

// ── GET /api/training/quiz-questions?productId= ────────────────
const getQuizQuestions = async (req, res) => {
  try {
    const { productId } = req.query;
    const filter = { isActive: true };
    if (productId) filter.productId = productId;
    const questions = await QuizQuestion.find(filter).sort({ createdAt: 1 });
    res.json({ success: true, data: questions });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/training/quiz-questions ───────────────────────────
const createQuizQuestion = async (req, res) => {
  try {
    const { productId, questionText, options, correctOptionIndex } = req.body;
    if (!productId || !questionText || !Array.isArray(options) || options.length !== 4)
      return res.status(400).json({ success: false, message: "productId, questionText and exactly 4 options are required" });
    if (correctOptionIndex === undefined || correctOptionIndex < 0 || correctOptionIndex > 3)
      return res.status(400).json({ success: false, message: "correctOptionIndex must be 0-3" });

    const question = await QuizQuestion.create({ productId, questionText, options, correctOptionIndex });
    res.status(201).json({ success: true, data: question, message: "Question added" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/quiz-questions/:id ────────────────────────
const updateQuizQuestion = async (req, res) => {
  try {
    const { questionText, options, correctOptionIndex } = req.body;
    if (options && options.length !== 4)
      return res.status(400).json({ success: false, message: "Exactly 4 options are required" });

    const updateFields = {};
    if (questionText !== undefined) updateFields.questionText = questionText;
    if (options !== undefined) updateFields.options = options;
    if (correctOptionIndex !== undefined) updateFields.correctOptionIndex = correctOptionIndex;

    const question = await QuizQuestion.findByIdAndUpdate(req.params.id, updateFields, { new: true });
    if (!question) return res.status(404).json({ success: false, message: "Question not found" });
    res.json({ success: true, data: question, message: "Question updated" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── DELETE /api/training/quiz-questions/:id ─────────────────────
const deleteQuizQuestion = async (req, res) => {
  try {
    await QuizQuestion.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Question deleted" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ═══════════════════════════════════════════════════════════════
// EMPLOYEE — STUDY TRACKING + QUIZ
// ═══════════════════════════════════════════════════════════════

const PASS_THRESHOLD = 70;   // %
const MAX_ATTEMPTS   = 1;    // single attempt only — no retakes

// ── PUT /api/training/my/:recordId/study-product ────────────────
// body: { productId }. Marks one product as studied for this record.
const markProductStudied = async (req, res) => {
  try {
    const { productId } = req.body;
    if (!productId) return res.status(400).json({ success: false, message: "productId required" });

    const record = await EmployeeTraining.findById(req.params.recordId);
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const existing = record.productProgress.find(p => String(p.productId) === String(productId));
    if (existing) {
      existing.studied = true;
      existing.studiedAt = new Date();
    } else {
      record.productProgress.push({ productId, studied: true, studiedAt: new Date() });
    }
    if (record.status === "pending" || record.status === "retrain") {
      record.status = "in_progress";
      if (!record.startedDate) record.startedDate = new Date();
    }
    await record.save();

    res.json({ success: true, data: record, message: "Marked as studied" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/training/my/:recordId/quiz ──────────────────────────
// Builds the combined quiz for a record: pulls questions from every
// product linked to the record's program (per-product, pooled).
const getQuiz = async (req, res) => {
  try {
    const record = await EmployeeTraining.findById(req.params.recordId).populate("programId");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const attemptsUsed = record.quizAttempts.length;
    if (attemptsUsed >= MAX_ATTEMPTS) {
      return res.status(403).json({ success: false, message: "You have already submitted this test. Only one attempt is allowed." });
    }

    const products = await Product.find({ trainingProgramId: record.programId?._id }).select("_id productName");
    if (!products.length) {
      return res.status(400).json({ success: false, message: "No products linked to this training" });
    }

    const productIds = products.map(p => p._id);
    const questions = await QuizQuestion.find({ productId: { $in: productIds }, isActive: true })
      .select("productId questionText options"); // correctOptionIndex withheld from employee

    if (!questions.length) {
      return res.status(400).json({ success: false, message: "No quiz questions available yet — check with HR" });
    }

    // Shuffle for a fresh order each attempt
    const shuffled = [...questions].sort(() => Math.random() - 0.5);

    res.json({
      success: true,
      data: {
        questions: shuffled,
        passThreshold: PASS_THRESHOLD,
      },
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/training/my/:recordId/quiz/submit ──────────────────
// body: { answers: [{ questionId, selectedOptionIndex }] }
const submitQuiz = async (req, res) => {
  try {
    const { answers } = req.body;
    if (!Array.isArray(answers) || !answers.length)
      return res.status(400).json({ success: false, message: "answers[] required" });

    const record = await EmployeeTraining.findById(req.params.recordId).populate("programId");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    if (record.quizAttempts.length >= MAX_ATTEMPTS) {
      return res.status(403).json({ success: false, message: "You have already submitted this test. Only one attempt is allowed." });
    }

    const questionIds = answers.map(a => a.questionId);
    const questions = await QuizQuestion.find({ _id: { $in: questionIds } });
    const qMap = new Map(questions.map(q => [String(q._id), q]));

    let correctCount = 0;
    const scoredAnswers = answers.map(a => {
      const q = qMap.get(String(a.questionId));
      const correct = !!q && q.correctOptionIndex === a.selectedOptionIndex;
      if (correct) correctCount++;
      return { questionId: a.questionId, selectedOptionIndex: a.selectedOptionIndex, correct };
    });

    const score = Math.round((correctCount / scoredAnswers.length) * 100);
    const passed = score >= PASS_THRESHOLD;

    record.quizAttempts.push({ score, passed, answers: scoredAnswers, attemptedAt: new Date() });
    record.assessmentScore = score;

    // Employee submitting the test does NOT auto-complete the record anymore —
    // pass or fail, it goes to HR for review. HR looks at the score and
    // manually marks the record "Completed" (+ issues certification) via
    // the Update Record modal. Only then does the employee see it as done.
    record.status = "pending_review";

    await record.save();

    await ComplianceLog.create({
      employeeId: record.employeeId,
      programId:  record.programId?._id,
      programTitle: record.programId?.title || "",
      action: "score_updated",
      note: `Quiz submitted — Score: ${score}% — awaiting HR review`,
      addedBy: "Employee",
    });

    res.json({
      success: true,
      data: {
        score,
        passed,
        status: record.status,
        certificationIssued: record.certificationIssued,
      },
      message: "Test submitted! HR will review your result and confirm training completion.",
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

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

      // ✅ NEW — "Retrain" resets the record so the employee has to re-study
      // every product and retake the test from scratch. Their previous
      // score/certification is cleared since it no longer applies.
      if (status === "retrain") {
        updateFields.productProgress = record.productProgress.map(p => ({ productId: p.productId, studied: false, studiedAt: null }));
        updateFields.quizAttempts = [];
        updateFields.assessmentScore = null;
        updateFields.certificationIssued = false;
        updateFields.certificationDate = null;
        updateFields.completedDate = null;
      }
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
        note: notes || progressNote || (status === "retrain" ? "Sent back for retraining — study checklist and test reset" : ""),
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
    if (certificationIssued === true && !record.certificationIssued) {
      await ComplianceLog.create({
        employeeId: record.employeeId,
        programId:  record.programId?._id,
        programTitle: record.programId?.title || "",
        action: "cert_issued",
        note: "Certification issued by HR after review",
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

// ═══════════════════════════════════════════════════════════════
// EQUIPMENT COMPETENCY (Knowledge/Product Portal)
// ═══════════════════════════════════════════════════════════════

// ── PUT /api/training/records/:id/competency ──────────────────
// Set the KNOW / OPERATE / SERVICE / TRAIN level for an equipment record.
const updateCompetencyLevel = async (req, res) => {
  try {
    const { competencyLevel, addedBy } = req.body;
    if (!["KNOW", "OPERATE", "SERVICE", "TRAIN"].includes(competencyLevel)) {
      return res.status(400).json({ success: false, message: "Invalid competency level" });
    }

    const record = await EmployeeTraining.findById(req.params.id).populate("programId");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    if (record.programId?.type !== "equipment") {
      return res.status(400).json({ success: false, message: "Competency levels only apply to equipment programs" });
    }

    record.competencyLevel = competencyLevel;
    await record.save();

    await ComplianceLog.create({
      employeeId: record.employeeId,
      programId:  record.programId._id,
      programTitle: record.programId.title,
      action: "score_updated",
      note: `Competency set to ${competencyLevel}`,
      addedBy: addedBy || "HR",
    });

    res.json({ success: true, data: record, message: `Competency set to ${competencyLevel}` });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

module.exports = {
  getAllPrograms, createProgram, updateProgram, deleteProgram, deleteAllPrograms, seedDefaultPrograms,
  backfillEquipmentPrograms, consolidateEquipmentPrograms, getOrCreateSharedEquipmentProgram, getProgramProducts,
  getQuizQuestions, createQuizQuestion, updateQuizQuestion, deleteQuizQuestion,
  markProductStudied, getQuiz, submitQuiz,
  assignTraining, assignBulk, getAllRecords, getStats, updateRecord, getComplianceLog,
  getMyTrainings, markStarted, updateCompetencyLevel,
};