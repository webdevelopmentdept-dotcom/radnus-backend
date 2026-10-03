const { TrainingProgram, EmployeeTraining, ComplianceLog, QuizQuestion } = require("../models/TrainingRca");
const Employee = require("../models/Employee");
const Product = require("../models/Product");
const { createNotification } = require("../helpers/notificationHelper");

// ═══════════════════════════════════════════════════════════════
// LOCK / UNLOCK HELPERS
// ═══════════════════════════════════════════════════════════════
// A record can be locked two ways:
//   - HR locks it manually, any time (lockReason: "manual")
//   - It locks itself automatically once dueDate has passed (lockReason: "auto_due_date")
// Once HR unlocks a record (unlockedAt gets set), auto-lock will NOT
// re-trigger for that record again — HR has to lock it again manually,
// or move the dueDate forward.
const lockMessage = (record) => record.lockReason === "manual"
  ? "This course has been locked by HR. Please contact HR to unlock it."
  : "This course's due date has passed and it has been locked. Please contact HR to unlock it.";

// Auto-locks a record the moment its dueDate has passed. Called lazily
// wherever a record is read/touched (list views + every employee action)
// so no separate cron/background process is needed.
const autoLockIfOverdue = async (record) => {
  if (!record) return record;
  if (record.isLocked) return record;                                   // already locked
  if (record.unlockedAt) return record;                                 // HR already unlocked once — don't re-lock automatically
  if (!record.dueDate) return record;
  if (["completed", "waived"].includes(record.status)) return record;   // finished — never lock
  const end = new Date(record.dueDate);
  end.setHours(23, 59, 59, 999);
  if (end >= new Date()) return record;                                 // not overdue yet

  record.isLocked   = true;
  record.lockReason = "auto_due_date";
  record.lockedAt   = new Date();
  record.lockedBy   = "System (auto)";
  await record.save();
  return record;
};

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
    const body = { ...req.body };
    const videoFile = req.files?.video?.[0];
    const pdfFile   = req.files?.pdf?.[0];

    if (videoFile) {                       // uploaded video file
      body.videoSource = "upload";
      body.videoUrl = videoFile.path;
      body.videoPublicId = videoFile.filename;
    } else if (body.videoUrl) {            // youtube link typed by HR
      body.videoSource = "youtube";
    }
    if (pdfFile) {                         // uploaded PDF file
      body.pdfUrl = pdfFile.path;
      body.pdfPublicId = pdfFile.filename;
      body.pdfName = pdfFile.originalname;
    }
    if (typeof body.modules === "string") body.modules = JSON.parse(body.modules); // FormData sends arrays as string

    // ✅ NEW — multi-chapter course support. HR sends `chapters` as a
    // JSON string; each chapter that has a newly-uploaded video carries
    // a `fileIndex` pointing into the `chapterVideos[]` files array
    // (chapters using a YouTube link or no video just keep their typed
    // videoUrl, no fileIndex).
    if (typeof body.chapters === "string") {
      const chapters = JSON.parse(body.chapters);
      const chapterVideoFiles = req.files?.chapterVideos || [];
      body.chapters = chapters.map((ch) => {
        if (ch.fileIndex !== undefined && ch.fileIndex !== null && chapterVideoFiles[ch.fileIndex]) {
          const f = chapterVideoFiles[ch.fileIndex];
          return { ...ch, videoSource: "upload", videoUrl: f.path, videoPublicId: f.filename };
        }
        const { fileIndex, ...rest } = ch;
        return rest;
      });
    }
    // Date range HR sets for the chapter course to be accessible
    if (body.accessStartDate === "") body.accessStartDate = null;
    if (body.accessEndDate === "")   body.accessEndDate   = null;

    const program = await TrainingProgram.create(body);
    res.status(201).json({ success: true, data: program, message: "Training program created" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/programs/:id ────────────────────────────
const updateProgram = async (req, res) => {
  try {
    const body = { ...req.body };
    const videoFile = req.files?.video?.[0];
    const pdfFile   = req.files?.pdf?.[0];

    if (videoFile) {
      body.videoSource = "upload";
      body.videoUrl = videoFile.path;
      body.videoPublicId = videoFile.filename;
    } else if (body.videoUrl && !body.videoSource) {
      body.videoSource = "youtube";
    }
    if (pdfFile) {                         // replace/attach PDF
      body.pdfUrl = pdfFile.path;
      body.pdfPublicId = pdfFile.filename;
      body.pdfName = pdfFile.originalname;
    }
    if (typeof body.modules === "string") body.modules = JSON.parse(body.modules);

    // ✅ NEW — same chapters[] + chapterVideos[] handling as createProgram
    // (HR editing an existing course: keep chapters whose video wasn't
    // replaced, swap in a fresh Cloudinary URL for ones that were).
    if (typeof body.chapters === "string") {
      const chapters = JSON.parse(body.chapters);
      const chapterVideoFiles = req.files?.chapterVideos || [];
      body.chapters = chapters.map((ch) => {
        if (ch.fileIndex !== undefined && ch.fileIndex !== null && chapterVideoFiles[ch.fileIndex]) {
          const f = chapterVideoFiles[ch.fileIndex];
          return { ...ch, videoSource: "upload", videoUrl: f.path, videoPublicId: f.filename };
        }
        const { fileIndex, ...rest } = ch;
        return rest;
      });
    }
    if (body.accessStartDate === "") body.accessStartDate = null;
    if (body.accessEndDate === "")   body.accessEndDate   = null;

    // ✅ Which chapters got a DIFFERENT video in this edit? (same chapterNo, new videoUrl)
    // Their old watch-tracking (length + watched ranges) belongs to the old video.
    let changedChapterNos = [];
    if (Array.isArray(body.chapters)) {
      const before = await TrainingProgram.findById(req.params.id).select("chapters");
      const oldChapters = before?.chapters || [];
      changedChapterNos = body.chapters
        .filter(nc => {
          const oc = oldChapters.find(c => Number(c.chapterNo) === Number(nc.chapterNo));
          return oc && (oc.videoUrl || "") !== (nc.videoUrl || "");
        })
        .map(nc => Number(nc.chapterNo));
    }

    const program = await TrainingProgram.findByIdAndUpdate(req.params.id, body, { new: true });
    if (!program) return res.status(404).json({ success: false, message: "Program not found" });

    // ✅ Reset tracking for those chapters — only for employees who have NOT completed them.
    // (Already-completed chapters stay completed; use "Retrain" if HR wants a redo.)
    if (changedChapterNos.length) {
      await EmployeeTraining.updateMany(
        { programId: program._id },
        {
          $set: {
            "chapterProgress.$[c].watchedRanges": [],
            "chapterProgress.$[c].duration": 0,
            "chapterProgress.$[c].lastPosition": 0,
            "chapterProgress.$[c].playedSeconds": 0,
            "chapterProgress.$[c].watchPercent": 0,
          },
          $unset: { "chapterProgress.$[c].startedAt": "", "chapterProgress.$[c].lastBeatAt": "" },
        },
        { arrayFilters: [{ "c.chapterNo": { $in: changedChapterNos }, "c.watched": { $ne: true } }] }
      );
    }
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

// ── GET /api/training/quiz-questions?productId=&programId= ─────
const getQuizQuestions = async (req, res) => {
  try {
    const { productId, programId } = req.query;
    const filter = { isActive: true };
    if (productId) filter.productId = productId;
    if (programId) filter.programId = programId;
    const questions = await QuizQuestion.find(filter).sort({ createdAt: 1 });
    res.json({ success: true, data: questions });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/training/quiz-questions ───────────────────────────
// body: { productId } OR { programId } — exactly one — plus the question.
const createQuizQuestion = async (req, res) => {
  try {
    const { productId, programId, questionText, options, correctOptionIndex } = req.body;
    if (!productId && !programId)
      return res.status(400).json({ success: false, message: "Either productId or programId is required" });
    if (productId && programId)
      return res.status(400).json({ success: false, message: "Link the question to a product OR a program, not both" });
    if (!questionText || !Array.isArray(options) || options.length !== 4)
      return res.status(400).json({ success: false, message: "questionText and exactly 4 options are required" });
    if (correctOptionIndex === undefined || correctOptionIndex < 0 || correctOptionIndex > 3)
      return res.status(400).json({ success: false, message: "correctOptionIndex must be 0-3" });

    const question = await QuizQuestion.create({ productId: productId || null, programId: programId || null, questionText, options, correctOptionIndex });
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
    await autoLockIfOverdue(record);                                                                  // ✅ NEW
    if (record.isLocked) return res.status(423).json({ success: false, message: lockMessage(record) }); // ✅ NEW

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

// ── PUT /api/training/my/:recordId/video-watched ─────────────────
// Called when the employee's <video> onEnded event fires (i.e. they
// actually watched the training video to completion, not just opened
// it). Used for non-equipment programs that only have a single
// program-level video (e.g. "Excel training").
const markVideoWatched = async (req, res) => {
  try {
    const record = await EmployeeTraining.findById(req.params.recordId);
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    await autoLockIfOverdue(record);                                                                  // ✅ NEW
    if (record.isLocked) return res.status(423).json({ success: false, message: lockMessage(record) }); // ✅ NEW

    if (!record.videoWatched) {
      record.videoWatched = true;
      record.videoWatchedAt = new Date();
    }
    if (record.status === "pending" || record.status === "retrain") {
      record.status = "in_progress";
      if (!record.startedDate) record.startedDate = new Date();
    }
    await record.save();

    res.json({ success: true, data: record, message: "Video marked as watched" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/my/:recordId/pdf-read ───────────────────────
// Employee explicitly confirms they've read the attached PDF (there's
// no reliable "finished reading" browser event for a PDF like there is
// for a video, so this is a deliberate confirm-click, gated in the UI
// on having opened the PDF at least once).
const markPdfRead = async (req, res) => {
  try {
    const record = await EmployeeTraining.findById(req.params.recordId);
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    await autoLockIfOverdue(record);                                                                  // ✅ NEW
    if (record.isLocked) return res.status(423).json({ success: false, message: lockMessage(record) }); // ✅ NEW

    if (!record.pdfRead) {
      record.pdfRead = true;
      record.pdfReadAt = new Date();
    }
    if (record.status === "pending" || record.status === "retrain") {
      record.status = "in_progress";
      if (!record.startedDate) record.startedDate = new Date();
    }
    await record.save();

    res.json({ success: true, data: record, message: "PDF marked as read" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── Chapter watch verification (server-side) ─────────────────────
// The browser sends a heartbeat every ~5s while a chapter video plays:
// { position, duration, rate }. The server only credits the stretch
// [lastPosition → position] as "watched" when it is physically possible
// — i.e. the video advanced no faster than real time since the previous
// heartbeat. Seeking/skipping, fast-forwarding, or sending fake numbers
// earns nothing. Credited ranges are merged & stored, so:
//   • watching in several sittings adds up,
//   • re-watching / rewinding never hurts,
//   • only the parts never really played stay "unwatched".
const REQUIRED_WATCH_PERCENT = 90;  // % of the video that must be verified — keep in sync with the frontend
const MAX_BEAT_GAP_SEC   = 40;      // ✅ raised from 25 — tolerate a throttled/backgrounded tab beat or two
const BEAT_TOLERANCE     = 1.5;
const BEAT_SLACK_SEC     = 4;   
const BUDGET_FACTOR      = 1.1;     // … but total credit can never exceed real time x 1.1
const BUDGET_SLACK_SEC   = 10;

const mergeRanges = (ranges) => {
  const sorted = ranges.map(r => [Number(r[0]), Number(r[1])]).filter(r => r[1] > r[0]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    if (out.length && s <= out[out.length - 1][1] + 0.6) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out.map(([s, e]) => [Math.round(s * 10) / 10, Math.round(e * 10) / 10]);
};
const coveredSeconds = (ranges) => ranges.reduce((sum, [s, e]) => sum + (e - s), 0);
const fmtVideoLen = (sec) => {
  const mins = Math.max(1, Math.round(sec / 60));
  const h = Math.floor(mins / 60), m = mins % 60;
  return h ? `${h} hr${m ? ` ${m} min` : ""}` : `${m} min`;
};

// Shared checks for heartbeat + complete. Returns { record, prog, error }.
const loadChapterRecord = async (recordId, chapterNo) => {
  const record = await EmployeeTraining.findById(recordId).populate("programId");
  if (!record) return { status: 404, error: "Record not found" };
  const prog = record.programId;
  if (!prog?.chapters?.length) return { status: 400, error: "This program has no chapters" };
  if (!prog.chapters.some(c => Number(c.chapterNo) === chapterNo)) return { status: 404, error: "Chapter not found" };

  // ✅ NEW — lock check (manual HR lock, or auto-locked once dueDate passed)
  await autoLockIfOverdue(record);
  if (record.isLocked) return { status: 423, error: lockMessage(record) };

  const now = new Date();
  if (prog.accessStartDate && now < new Date(prog.accessStartDate)) return { status: 403, error: "This course is not open yet" };
  if (prog.accessEndDate && now > new Date(prog.accessEndDate)) return { status: 403, error: "This course's access window has ended" };
  return { record, prog };
};

// ── PUT /api/training/my/:recordId/chapter/:chapterNo/heartbeat ──
const markChapterHeartbeat = async (req, res) => {
  try {
    const num = Number(req.params.chapterNo);
    const position = Number(req.body.position);
    const reportedDuration = Number(req.body.duration);
    if (!Number.isFinite(position) || !Number.isFinite(reportedDuration) || reportedDuration <= 0 || position < 0) {
      return res.status(400).json({ success: false, message: "Invalid heartbeat" });
    }

    for (let attempt = 0; attempt < 3; attempt++) {
      const { record, prog, error, status } = await loadChapterRecord(req.params.recordId, num);
      if (error) return res.status(status).json({ success: false, message: error });
      // ✅ heartbeats only make sense for video chapters; PDF chapters use "Mark as Read" instead
      if (prog?.chapters?.find(c => Number(c.chapterNo) === num)?.contentType === "pdf") {
        return res.status(400).json({ success: false, message: "This chapter is a PDF — use Mark as Read." });
      }

      const watchedCount = record.chapterProgress.filter(c => c.watched).length;
      let cp = record.chapterProgress.find(c => c.chapterNo === num);
      if (!cp && num > watchedCount + 1) {
        return res.status(400).json({ success: false, message: "Previous chapter must be completed first" });
      }
      if (!cp) {
        record.chapterProgress.push({ chapterNo: num, watched: false, watchPercent: 0 });
        cp = record.chapterProgress[record.chapterProgress.length - 1];
      }

      const payload = (c) => ({
        chapterNo: num, watched: !!c.watched, percent: c.watchPercent || 0,
        ranges: c.watchedRanges || [], duration: c.duration || 0, lastPosition: c.lastPosition || 0,
        ready: (c.watchPercent || 0) >= REQUIRED_WATCH_PERCENT, required: REQUIRED_WATCH_PERCENT,
      });

      // Already completed: nothing more to track.
      if (cp.watched) return res.json({ success: true, data: payload(cp) });

      const now = Date.now();
      if (!cp.duration) cp.duration = reportedDuration;      // lock the length from the first beat
      // Chapter length is never typed by HR: if the program's chapter has none yet
      // (e.g. a YouTube link), fill it from the first play. Only fills an empty value.
      if (!record.programId.chapters.find(c => Number(c.chapterNo) === num)?.duration) {
        TrainingProgram.updateOne(
          { _id: record.programId._id, chapters: { $elemMatch: { chapterNo: num, $or: [{ duration: "" }, { duration: { $exists: false } }] } } },
          { $set: { "chapters.$.duration": fmtVideoLen(reportedDuration) } }
        ).catch(() => {});
      }
      const duration = cp.duration;
      const pos = Math.min(position, duration);
      if (!cp.startedAt) cp.startedAt = new Date(now);

      const prevPos = cp.lastPosition || 0;
      const prevAt  = cp.lastBeatAt ? cp.lastBeatAt.getTime() : null;

      if (prevAt !== null) {
        const elapsed = (now - prevAt) / 1000;
        const delta = pos - prevPos;
        const realSinceStart = (now - cp.startedAt.getTime()) / 1000;
        const plausibleStep = elapsed <= MAX_BEAT_GAP_SEC && delta > 0 && delta <= elapsed * BEAT_TOLERANCE + BEAT_SLACK_SEC;
        const withinBudget  = (cp.playedSeconds || 0) + delta <= realSinceStart * BUDGET_FACTOR + BUDGET_SLACK_SEC;
        if (plausibleStep && withinBudget) {
          cp.watchedRanges = mergeRanges([...(cp.watchedRanges || []), [prevPos, pos]]);
          cp.playedSeconds = (cp.playedSeconds || 0) + delta;
        }
      }

      cp.lastPosition = pos;
      cp.lastBeatAt = new Date(now);
      cp.watchPercent = Math.min(100, Math.round((coveredSeconds(cp.watchedRanges || []) / duration) * 100));
      record.markModified("chapterProgress");

      try {
        await record.save();
        return res.json({ success: true, data: payload(cp) });
      } catch (e) {
        if (e.name === "VersionError" && attempt < 2) continue; // two beats raced — retry
        throw e;
      }
    }
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/my/:recordId/chapter/:chapterNo/watched ────
// Marks ONE chapter complete. Enforces:
//  1. Idempotent — completing an already-completed chapter is a no-op success
//     (fixes the duplicate "Previous chapter must be completed first" error).
//  2. Sequential unlock — can't jump ahead by calling the API directly.
//  3. Anti-skip — uses the SERVER-verified watch percent (from heartbeats),
//     never a number sent by the browser.
//  4. Access window (accessStartDate / accessEndDate).
const markChapterWatchedOnce = async (req, res) => {
  try {
    const num = Number(req.params.chapterNo);
    const { record, prog, error, status } = await loadChapterRecord(req.params.recordId, num);
    if (error) return res.status(status).json({ success: false, message: error });

    const existing = record.chapterProgress.find(c => c.chapterNo === num);
    if (existing?.watched) {
      return res.json({ success: true, data: record, message: `Chapter ${num} already completed` });
    }

    const watchedCount = record.chapterProgress.filter(c => c.watched).length;
    if (num > watchedCount + 1) {
      return res.status(400).json({ success: false, message: "Previous chapter must be completed first" });
    }

    const chapterDef = prog?.chapters?.find(c => Number(c.chapterNo) === num);
    // ✅ NEW — a chapter with a quiz doesn't complete on this click.
    const hasQuiz = (chapterDef?.quizQuestions?.length || 0) > 0;

    // Already confirmed the content, just waiting on the quiz below — nothing to redo.
    if (hasQuiz && existing?.contentDone) {
      return res.json({ success: true, data: record, message: `Content already confirmed for chapter ${num} — take the quiz below to finish it.` });
    }

    // PDF chapters: "Mark as Read" is a direct click, no watch-percent to verify.
    if (chapterDef?.contentType !== "pdf") {
      const verified = existing?.watchPercent || 0;
      if (verified < REQUIRED_WATCH_PERCENT) {
        return res.status(400).json({
          success: false,
          message: `Only ${verified}% of this chapter is verified as watched (need ${REQUIRED_WATCH_PERCENT}%). Please watch the parts you skipped.`,
        });
      }
    }

    if (!existing) record.chapterProgress.push({ chapterNo: num, watched: false, watchPercent: 0 });
    const cp = record.chapterProgress.find(c => c.chapterNo === num);

    // ✅ NEW — a chapter with a quiz only reaches "content confirmed" here;
    // it becomes watched (and unlocks the next chapter) only once the
    // quiz is passed, via submitChapterQuiz below. No quiz = unchanged,
    // exact old behaviour: this click completes the chapter outright.
    if (hasQuiz) {
      cp.contentDone = true;
      cp.contentDoneAt = new Date();
    } else {
      cp.watched = true;
      cp.watchedAt = new Date();
    }
    record.markModified("chapterProgress");

    if (record.status === "pending" || record.status === "retrain") {
      record.status = "in_progress";
      if (!record.startedDate) record.startedDate = new Date();
    }
    await record.save();

    // ✅ NEW — one milestone log entry when the LAST chapter is completed
    // this way (no quiz on it), so HR's Compliance Log shows the course
    // was finished without a per-chapter entry for every single chapter.
    if (!hasQuiz && cp.watched) {
      const doneCount = record.chapterProgress.filter(c => c.watched).length;
      if (doneCount === prog.chapters.length) {
        await ComplianceLog.create({
          employeeId: record.employeeId,
          programId:  prog._id,
          programTitle: prog.title || "",
          action: "score_updated",
          note: `All ${prog.chapters.length} chapters completed — Final Test unlocked`,
          addedBy: "Employee",
        });
      }
    }

    res.json({
      success: true,
      data: record,
      message: hasQuiz ? `Content confirmed for chapter ${num} — take the quiz below to finish it.` : `Chapter ${num} completed`,
    });
  } catch (err) {
    if (err.name === "VersionError") throw err; // let the retry wrapper below handle it
    res.status(500).json({ success: false, message: err.message });
  }
};

// Retries when a heartbeat saved the same record at the same moment (VersionError).
// The record is re-loaded on every attempt, so the latest heartbeat data is kept.
const markChapterWatched = async (req, res) => {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await markChapterWatchedOnce(req, res);
    } catch (err) {
      if (err.name === "VersionError" && attempt < 3) continue;
      return res.status(500).json({ success: false, message: err.message });
    }
  }
};

// ── GET /api/training/my/:recordId/chapter/:chapterNo/quiz ───────
// ✅ NEW — optional per-chapter "understanding check" quiz. Completely
// separate from the program Final Test (getQuiz/submitQuiz above):
// unlimited retries, only gates the NEXT chapter unlocking, never
// blocked by MAX_ATTEMPTS, never touches certification/HR review.
const getChapterQuiz = async (req, res) => {
  try {
    const num = Number(req.params.chapterNo);
    const { record, prog, error, status } = await loadChapterRecord(req.params.recordId, num);
    if (error) return res.status(status).json({ success: false, message: error });

    const chapterDef = prog.chapters.find(c => Number(c.chapterNo) === num);
    const questions = chapterDef?.quizQuestions || [];
    if (!questions.length) {
      return res.status(400).json({ success: false, message: "This chapter has no quiz" });
    }

    // ✅ NEW — quiz only unlocks AFTER the video/PDF is confirmed done
    // (via markChapterWatched, which sets contentDone for a quizzed chapter).
    const existing = record.chapterProgress.find(c => c.chapterNo === num);
    if (!existing?.contentDone && !existing?.watched) {
      return res.status(400).json({
        success: false,
        message: chapterDef.contentType === "pdf" ? 'Click "Mark as Read" first.' : 'Finish watching the video and click "Complete chapter" first.',
      });
    }

    // Withhold correctOptionIndex from the employee. Each question's
    // position in this array (its "index") is how the submit endpoint
    // below identifies it — no separate _id needed for a sub-subdocument.
    const safeQuestions = questions.map((q, i) => ({ index: i, questionText: q.questionText, options: q.options }));

    res.json({ success: true, data: { questions: safeQuestions, passThreshold: PASS_THRESHOLD } });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── POST /api/training/my/:recordId/chapter/:chapterNo/quiz/submit ──
// body: { answers: [{ index, selectedOptionIndex }] }
// Unlike submitQuiz (Final Test), this allows UNLIMITED attempts — it's
// a learning check, not a certification gate. Passing (score >=
// PASS_THRESHOLD) marks the chapter watched exactly the way
// markChapterWatched does, so the next chapter unlocks the same way in
// both cases. The video's server-verified watch% (or, for a PDF
// chapter, simply having reached this screen) is still required first —
// the quiz sits AFTER finishing the content, it never replaces it.
const submitChapterQuiz = async (req, res) => {
  try {
    const num = Number(req.params.chapterNo);
    const { answers } = req.body;
    if (!Array.isArray(answers) || !answers.length) {
      return res.status(400).json({ success: false, message: "answers[] required" });
    }

    const { record, prog, error, status } = await loadChapterRecord(req.params.recordId, num);
    if (error) return res.status(status).json({ success: false, message: error });

    const existing = record.chapterProgress.find(c => c.chapterNo === num);
    if (existing?.watched) {
      // Idempotent, same as markChapterWatched — nothing left to do.
      return res.json({ success: true, data: { record, score: existing.lastScore ?? 100, passed: true, alreadyCompleted: true } , message: `Chapter ${num} already completed` });
    }

    const watchedCount = record.chapterProgress.filter(c => c.watched).length;
    if (num > watchedCount + 1) {
      return res.status(400).json({ success: false, message: "Previous chapter must be completed first" });
    }

    const chapterDef = prog?.chapters?.find(c => Number(c.chapterNo) === num);
    const questions = chapterDef?.quizQuestions || [];
    if (!questions.length) {
      return res.status(400).json({ success: false, message: "This chapter has no quiz" });
    }

    // ✅ NEW — quiz only submittable AFTER the video/PDF is confirmed done
    // (contentDone, set by markChapterWatched) — same gate as getChapterQuiz above.
    if (!existing?.contentDone) {
      return res.status(400).json({
        success: false,
        message: chapterDef.contentType === "pdf" ? 'Click "Mark as Read" first.' : 'Finish watching the video and click "Complete chapter" first.',
      });
    }

    let correctCount = 0;
    answers.forEach(a => {
      const q = questions[Number(a.index)];
      if (q && q.correctOptionIndex === a.selectedOptionIndex) correctCount++;
    });
    const total = questions.length;
    const score = Math.round((correctCount / total) * 100);
    const passed = score >= PASS_THRESHOLD;

    if (!existing) record.chapterProgress.push({ chapterNo: num, watched: false, watchPercent: 0 });
    const cp = record.chapterProgress.find(c => c.chapterNo === num);
    cp.quizAttempts = cp.quizAttempts || [];
    cp.quizAttempts.push({ score, passed, attemptedAt: new Date() });
    cp.lastScore = score;

    if (passed) {
      cp.watched = true;
      cp.watchedAt = new Date();
    }
    record.markModified("chapterProgress");

    if (record.status === "pending" || record.status === "retrain") {
      record.status = "in_progress";
      if (!record.startedDate) record.startedDate = new Date();
    }
    await record.save();

    // ✅ NEW — log a failed chapter-quiz attempt (HR visibility that the
    // employee is struggling on a specific chapter), and a single
    // milestone entry once the LAST chapter is passed. Unlimited retries
    // on this quiz mean we intentionally don't log every attempt — just
    // fails (for visibility) and the final pass that finishes the course.
    if (!passed) {
      await ComplianceLog.create({
        employeeId: record.employeeId,
        programId:  prog._id,
        programTitle: prog.title || "",
        action: "score_updated",
        note: `Chapter ${num} quiz attempt failed — scored ${score}% (needs ${PASS_THRESHOLD}%)`,
        addedBy: "Employee",
      });
    } else {
      const doneCount = record.chapterProgress.filter(c => c.watched).length;
      if (doneCount === prog.chapters.length) {
        await ComplianceLog.create({
          employeeId: record.employeeId,
          programId:  prog._id,
          programTitle: prog.title || "",
          action: "score_updated",
          note: `All ${prog.chapters.length} chapters completed — Final Test unlocked`,
          addedBy: "Employee",
        });
      }
    }

    res.json({
      success: true,
      data: { record, score, passed, correctCount, total },
      message: passed ? `Chapter ${num} completed` : `You scored ${score}% — try again`,
    });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/my/:recordId/certificate/request ───────────
// ✅ NEW — employee has finished every chapter + passed the quiz →
// requests HR to issue a certificate. Nothing is auto-generated; this
// just flips the record into "requested" so it shows up in HR's
// Certificate Requests list.
const requestCertificate = async (req, res) => {
  try {
    const record = await EmployeeTraining.findById(req.params.recordId).populate("programId").populate("employeeId", "name");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const prog = record.programId;
    if (prog?.chapters?.length) {
      const watchedCount = record.chapterProgress.filter(c => c.watched).length;
      if (watchedCount < prog.chapters.length) {
        return res.status(400).json({ success: false, message: "Finish every chapter before requesting a certificate" });
      }
    }
    const lastAttempt = record.quizAttempts?.[record.quizAttempts.length - 1];
    if (!lastAttempt || !lastAttempt.passed) {
      return res.status(400).json({ success: false, message: "Pass the quiz before requesting a certificate" });
    }
    if (record.certificateRequestStatus === "issued") {
      return res.json({ success: true, data: record, message: "Certificate already issued" });
    }

    record.certificateRequestStatus = "requested";
    record.certificateRequestedAt = new Date();
    await record.save();

    await createNotification({
      recipient_id:   "hr_admin_001",
      recipient_role: "hr",
      type:           "employee",
      title:          `Certificate Requested — ${record.employeeId?.name || "Employee"} 🎓`,
      message:        `${record.employeeId?.name || "An employee"} completed "${prog?.title || "a training"}" and requested their certificate.`,
      link:           "/hr/dashboard/training",
    });

    res.json({ success: true, data: record, message: "Certificate requested — HR will upload it shortly" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/records/:id/certificate ─────────────────────
// ✅ NEW — HR uploads the actual certificate file for one employee's
// record (multer field name "certificate"). Employee can then
// download it from their side.
const uploadCertificate = async (req, res) => {
  try {
    const file = req.files?.certificate?.[0] || req.file;
    if (!file) return res.status(400).json({ success: false, message: "Certificate file required" });

    const record = await EmployeeTraining.findById(req.params.id).populate("programId").populate("employeeId", "name");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    record.certificateUrl = file.path;
    record.certificatePublicId = file.filename;
    record.certificateFileName = file.originalname;
    record.certificateRequestStatus = "issued";
    record.certificateIssuedAt = new Date();
    record.certificationIssued = true;
    record.certificationDate = new Date();
    await record.save();

    await createNotification({
      recipient_id:   String(record.employeeId?._id || record.employeeId),
      recipient_role: "employee",
      type:           "hr",
      title:          "Certificate Ready 🎓",
      message:        `Your certificate for "${record.programId?.title || "your training"}" is ready to download.`,
      link:           "/employee/training",
    });

    res.json({ success: true, data: record, message: "Certificate uploaded" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/my/:recordId/complete ──────────────────────
// For NON-equipment programs only (no quiz to unlock this) — e.g.
// "Excel training". Employee clicks "Mark as Completed" once the video
// is watched; this pushes the record into pending_review, same as a
// submitted quiz, so HR still has to confirm it before it counts as
// truly completed.
const markProgramComplete = async (req, res) => {
  try {
    const record = await EmployeeTraining.findById(req.params.recordId).populate("programId").populate("employeeId", "name");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    if (record.programId?.type === "equipment") {
      return res.status(400).json({ success: false, message: "Equipment trainings must be completed via the quiz, not this action" });
    }
    if (!record.videoWatched && record.programId?.videoUrl) {
      return res.status(400).json({ success: false, message: "Watch the training video till the end before marking this complete" });
    }
    if (!record.pdfRead && record.programId?.pdfUrl) {
      return res.status(400).json({ success: false, message: "Read the training PDF before marking this complete" });
    }
    if (["completed", "pending_review"].includes(record.status)) {
      return res.json({ success: true, data: record, message: "Already submitted" });
    }

    record.status = "pending_review";
    await record.save();

    await createNotification({
      recipient_id:   "hr_admin_001",
      recipient_role: "hr",
      type:           "employee",
      title:          `Training Submitted — ${record.employeeId?.name || "Employee"} 📚`,
      message:        `${record.employeeId?.name || "An employee"} has submitted "${record.programId?.title || "a training"}" for your review.`,
      link:           "/hr/dashboard/training",
    });

    res.json({ success: true, data: record, message: "Submitted for HR review" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── GET /api/training/my/:recordId/quiz ──────────────────────────
// Builds the quiz for a record. Equipment programs pool questions
// across every linked product; non-equipment programs (e.g. "Excel
// training") use questions linked directly to the program.
const getQuiz = async (req, res) => {
  try {
    const record = await EmployeeTraining.findById(req.params.recordId).populate("programId");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    await autoLockIfOverdue(record);                                                                  // ✅ NEW
    if (record.isLocked) return res.status(423).json({ success: false, message: lockMessage(record) }); // ✅ NEW

    const attemptsUsed = record.quizAttempts.length;
    if (attemptsUsed >= MAX_ATTEMPTS) {
      return res.status(403).json({ success: false, message: "You have already submitted this test. Only one attempt is allowed." });
    }

    let questions;
    if (record.programId?.type === "equipment") {
      const products = await Product.find({ trainingProgramId: record.programId?._id }).select("_id productName");
      if (!products.length) {
        return res.status(400).json({ success: false, message: "No products linked to this training" });
      }
      const productIds = products.map(p => p._id);
      questions = await QuizQuestion.find({ productId: { $in: productIds }, isActive: true })
        .select("productId questionText options"); // correctOptionIndex withheld from employee
    } else {
      questions = await QuizQuestion.find({ programId: record.programId?._id, isActive: true })
        .select("programId questionText options");
    }

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

    const record = await EmployeeTraining.findById(req.params.recordId).populate("programId").populate("employeeId", "name");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });
    await autoLockIfOverdue(record);                                                                  // ✅ NEW
    if (record.isLocked) return res.status(423).json({ success: false, message: lockMessage(record) }); // ✅ NEW

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

    await createNotification({
      recipient_id:   "hr_admin_001",
      recipient_role: "hr",
      type:           "employee",
      title:          `Training Test Submitted — ${record.employeeId?.name || "Employee"} 📚`,
      message:        `${record.employeeId?.name || "An employee"} scored ${score}% on "${record.programId?.title || "a training"}" and it's ready for your review.`,
      link:           "/hr/dashboard/training",
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

    await createNotification({
      recipient_id:   employeeId,
      recipient_role: "employee",
      type:           "hr",
      title:          "New Training Assigned 📚",
      message:        `"${prog.title}" has been assigned to you. Check your training roadmap.`,
      link:           "/employee/training",
    });

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

      await createNotification({
        recipient_id:   empId,
        recipient_role: "employee",
        type:           "hr",
        title:          "New Training Assigned 📚",
        message:        `"${prog.title}" has been assigned to you. Check your training roadmap.`,
        link:           "/employee/training",
      });

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
      .populate("quizAttempts.answers.questionId", "questionText options correctOptionIndex")
      .sort({ assignedDate: -1 });

    // Filter by department
    if (department) {
      records = records.filter(r => r.employeeId?.department === department);
    }

    await Promise.all(records.map(r => autoLockIfOverdue(r))); // ✅ NEW — reflect due-date auto-lock before HR sees the list

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
    const { status, assessmentScore, certificationIssued, notes, addedBy, progressNote, dueDate } = req.body;

    const record = await EmployeeTraining.findById(req.params.id).populate("programId");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    const updateFields = {};
    if (status !== undefined) {
      updateFields.status = status;
      if (status === "in_progress" && !record.startedDate) updateFields.startedDate = new Date();
      if (status === "completed") {
        updateFields.completedDate = new Date();
        // ✅ HR approving the record (marking it Completed) IS the review step —
        // employee no longer clicks "Request Certificate" themselves. As soon as
        // HR confirms completion, automatically push the record into the
        // "requested" certificate state so it shows up in HR's own Certificate
        // Requests tab, ready for them to upload the file. Only auto-request if
        // nothing has been requested/issued yet (don't clobber an already-issued cert).
        if (record.certificateRequestStatus === "none") {
          updateFields.certificateRequestStatus = "requested";
          updateFields.certificateRequestedAt = new Date();
        }
      }
      if (status === "overdue" && !record.startedDate) updateFields.startedDate = null;

      // "Retrain" resets the record so the employee has to re-study
      // every product and retake the test from scratch. Their previous
      // score/certification is cleared since it no longer applies.
      if (status === "retrain") {
        updateFields.productProgress = record.productProgress.map(p => ({ productId: p.productId, studied: false, studiedAt: null }));
        updateFields.quizAttempts = [];
        updateFields.assessmentScore = null;
        updateFields.certificationIssued = false;
        updateFields.certificationDate = null;
        updateFields.completedDate = null;
        // Clear any stale certificate request/issue state from a previous pass
        // too, so a retrained employee goes through "waiting for HR review" →
        // "HR will upload soon" → "Download" again, instead of jumping straight
        // to an old (no-longer-valid) certificate.
        updateFields.certificateRequestStatus = "none";
        updateFields.certificateRequestedAt = null;
        updateFields.certificateUrl = "";
        updateFields.certificatePublicId = "";
        updateFields.certificateFileName = "";
        updateFields.certificateIssuedAt = null;
      }
    }
    if (assessmentScore !== undefined) updateFields.assessmentScore = assessmentScore;
    if (certificationIssued !== undefined) {
      updateFields.certificationIssued = certificationIssued;
      if (certificationIssued) updateFields.certificationDate = new Date();
    }
    if (notes) updateFields.notes = notes;

    // ✅ NEW — HR can change the due date of an already-assigned record.
    // Blank/null clears the deadline. Only acts when the date really changed.
    let dueDateChanged = false;
    if (dueDate !== undefined) {
      const newDue = dueDate ? new Date(dueDate) : null;
      if (newDue && isNaN(newDue.getTime())) {
        return res.status(400).json({ success: false, message: "Invalid due date" });
      }
      const oldDay = record.dueDate ? new Date(record.dueDate).toISOString().slice(0, 10) : "";
      const newDay = newDue ? newDue.toISOString().slice(0, 10) : "";
      if (oldDay !== newDay) {
        dueDateChanged = true;
        updateFields.dueDate = newDue;

        // New deadline is still in the future (or removed) → the old overdue
        // situation no longer applies:
        //  • if the course was AUTO-locked because of the old due date, unlock it
        //    (a MANUAL HR lock is left untouched)
        //  • clear unlockedAt/unlockedBy so auto-lock can work again for the new date
        const stillFuture = !newDue || (() => { const e = new Date(newDue); e.setHours(23, 59, 59, 999); return e >= new Date(); })();
        if (stillFuture) {
          if (record.isLocked && record.lockReason === "auto_due_date") {
            updateFields.isLocked   = false;
            updateFields.lockReason = null;
          }
          updateFields.$unset = { unlockedAt: "", unlockedBy: "" };
        }
      }
    }

    // Add progress note
    if (progressNote) {
      updateFields.$push = { progressLog: { note: progressNote, addedBy: addedBy || "HR" } };
    }

    const updated = await EmployeeTraining.findByIdAndUpdate(req.params.id, updateFields, { new: true })
      .populate("employeeId", "name department designation")
      .populate("programId");

    // ✅ NEW — audit entry for due date change
    if (dueDateChanged) {
      const fmt = (d) => d ? new Date(d).toLocaleDateString("en-IN") : "no deadline";
      await ComplianceLog.create({
        employeeId: record.employeeId,
        programId:  record.programId?._id,
        programTitle: record.programId?.title || "",
        action: "assigned", // reuse existing enum value; note carries the real context
        note: `Due date changed from ${fmt(record.dueDate)} to ${fmt(updateFields.dueDate)}`,
        addedBy: addedBy || "HR",
      });
    }

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

      // HR confirmed this training as complete — notify the employee
      if (status === "completed") {
        await createNotification({
          recipient_id:   record.employeeId,
          recipient_role: "employee",
          type:           "hr",
          title:          "Training Completed ✅",
          message:        `HR has confirmed "${record.programId?.title || "your training"}" as complete.${assessmentScore !== undefined ? ` Score: ${assessmentScore}%.` : ""}`,
          link:           "/employee/training",
        });
      }

      // HR sent the record back for retraining — let the employee know
      if (status === "retrain") {
        await createNotification({
          recipient_id:   record.employeeId,
          recipient_role: "employee",
          type:           "hr",
          title:          "Retraining Required 🔁",
          message:        `HR has asked you to retrain on "${record.programId?.title || "your training"}". Please go through the material again and retake the test.`,
          link:           "/employee/training",
        });
      }
    }

          // HR marked this record as absent/not attended (offline session exception)
      if (status === "absent") {
        await createNotification({
          recipient_id:   record.employeeId,
          recipient_role: "employee",
          type:           "hr",
          title:          "Marked Absent",
          message:        `HR has marked you absent / not attended for "${record.programId?.title || "your training"}". Please reach out to HR to reschedule.`,
          link:           "/employee/training",
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

// ── DELETE /api/training/records/:id ──────────────────────────
// Permanently removes a single employee's training assignment —
// used by both the "Delete" button (HR confirms first) and the
// "Unassign" quick-action (no confirm, has its own Undo toast) on
// the frontend. Also cleans up score/quiz compliance-log noise for
// that record so the log doesn't reference a record that no longer
// exists.
const deleteRecord = async (req, res) => {
  try {
    const record = await EmployeeTraining.findById(req.params.id).populate("employeeId", "name").populate("programId", "title");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    await EmployeeTraining.findByIdAndDelete(req.params.id);

    await ComplianceLog.create({
      employeeId: record.employeeId?._id || record.employeeId,
      programId:  record.programId?._id,
      programTitle: record.programId?.title || "",
      action: "assigned", // reuse existing enum value; note field carries the real context
      note: `Training record removed by HR (was: ${record.status})`,
      addedBy: req.body?.addedBy || "HR",
    });

    res.json({ success: true, message: "Training record deleted" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/records/:id/lock ─────────────────────────
// HR manually locks a course for one employee, any time (before or
// after the due date — HR's call).
const lockRecord = async (req, res) => {
  try {
    const { addedBy, reason } = req.body;
    const record = await EmployeeTraining.findById(req.params.id).populate("employeeId", "name").populate("programId", "title");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    record.isLocked   = true;
    record.lockReason = "manual";
    record.lockedAt   = new Date();
    record.lockedBy   = addedBy || "HR";
    await record.save();

    await ComplianceLog.create({
      employeeId: record.employeeId?._id || record.employeeId,
      programId:  record.programId?._id,
      programTitle: record.programId?.title || "",
      action: "overdue", // reuse existing enum value; note carries the real context
      note: reason ? `Course locked by HR — ${reason}` : "Course locked by HR",
      addedBy: addedBy || "HR",
    });

    await createNotification({
      recipient_id:   record.employeeId?._id || record.employeeId,
      recipient_role: "employee",
      type:           "hr",
      title:          "Training Locked 🔒",
      message:        `HR has locked "${record.programId?.title || "your training"}". Contact HR to get it unlocked.`,
      link:           "/employee/training",
    });

    res.json({ success: true, data: record, message: "Training locked" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/records/:id/unlock ────────────────────────
// HR removes a lock (manual or auto due-date) so the employee can
// continue. Once unlocked this way, auto-lock will not re-trigger for
// this record again (see autoLockIfOverdue) — HR can lock it again
// manually any time, or move the dueDate forward.
const unlockRecord = async (req, res) => {
  try {
    const { addedBy } = req.body;
    const record = await EmployeeTraining.findById(req.params.id).populate("employeeId", "name").populate("programId", "title");
    if (!record) return res.status(404).json({ success: false, message: "Record not found" });

    record.isLocked   = false;
    record.lockReason = null;
    record.unlockedAt = new Date();
    record.unlockedBy = addedBy || "HR";
    await record.save();

    await ComplianceLog.create({
      employeeId: record.employeeId?._id || record.employeeId,
      programId:  record.programId?._id,
      programTitle: record.programId?.title || "",
      action: "overdue",
      note: "Course unlocked by HR",
      addedBy: addedBy || "HR",
    });

    await createNotification({
      recipient_id:   record.employeeId?._id || record.employeeId,
      recipient_role: "employee",
      type:           "hr",
      title:          "Training Unlocked ✅",
      message:        `HR has unlocked "${record.programId?.title || "your training"}". You can continue now.`,
      link:           "/employee/training",
    });

    res.json({ success: true, data: record, message: "Training unlocked" });
  } catch (err) { res.status(500).json({ success: false, message: err.message }); }
};

// ── PUT /api/training/programs/:id/mark-all-complete ─────────
// "Finish Training" — offline/instructor-led programs-ku. Assign panna
// ella employees-um (already completed/waived illatha) "completed" ah
// bulk mark pannum. Absent aana person-a HR Records tab-la individually
// "absent" ah maathanum.
const markAllComplete = async (req, res) => {
  try {
    const prog = await TrainingProgram.findById(req.params.id);
    if (!prog) return res.status(404).json({ success: false, message: "Program not found" });

    const records = await EmployeeTraining.find({
      programId: req.params.id,
      status: { $nin: ["completed", "waived"] },
    }).populate("employeeId", "name");

    if (!records.length) {
      return res.json({ success: true, data: { updated: 0 }, message: "Nothing to update — everyone assigned is already completed." });
    }

    const now = new Date();
    let updated = 0;

    for (const record of records) {
      record.status = "completed";
      record.completedDate = now;
      if (!record.startedDate) record.startedDate = now;
       record.progressLog.push({ note: "Marked complete via HR bulk 'Finish Training'", addedBy: req.body?.addedBy || "HR" });
      await record.save();

      await ComplianceLog.create({
        employeeId: record.employeeId?._id || record.employeeId,
        programId: prog._id,
        programTitle: prog.title,
        action: "bulk_completed",
        note: "Marked complete via HR bulk 'Finish Training'",
        addedBy: req.body?.addedBy || "HR",
      });

      await createNotification({
        recipient_id:   record.employeeId?._id || record.employeeId,
        recipient_role: "employee",
        type:           "hr",
        title:          "Training Completed ✅",
        message:        `HR has marked "${prog.title}" as complete for you.`,
        link:           "/employee/training",
      });

      updated++;
    }

    res.json({ success: true, data: { updated }, message: `Marked ${updated} employee${updated === 1 ? "" : "s"} as completed.` });
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

    await Promise.all(records.map(r => autoLockIfOverdue(r))); // ✅ NEW — reflect due-date auto-lock before the employee sees it

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
    // ✅ NEW — lock check before allowing "start"
    const existing = await EmployeeTraining.findById(req.params.recordId);
    if (!existing) return res.status(404).json({ success: false, message: "Record not found" });
    await autoLockIfOverdue(existing);
    if (existing.isLocked) return res.status(423).json({ success: false, message: lockMessage(existing) });

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
// PUDHU CODE (replace pannu):
module.exports = {
  getAllPrograms, createProgram, updateProgram, deleteProgram, deleteAllPrograms, seedDefaultPrograms,
  backfillEquipmentPrograms, consolidateEquipmentPrograms, getOrCreateSharedEquipmentProgram, getProgramProducts,
  getQuizQuestions, createQuizQuestion, updateQuizQuestion, deleteQuizQuestion, markVideoWatched, markPdfRead, markProgramComplete,
  markProductStudied, getQuiz, submitQuiz,
  assignTraining, assignBulk, getAllRecords, getStats, updateRecord, deleteRecord, markAllComplete, getComplianceLog,
  getMyTrainings, markStarted, updateCompetencyLevel,
  markChapterWatched, markChapterHeartbeat, requestCertificate, uploadCertificate,
  getChapterQuiz, submitChapterQuiz,
  lockRecord, unlockRecord, // ✅ NEW
};