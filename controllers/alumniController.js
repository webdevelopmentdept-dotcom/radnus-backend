const AlumniProfile = require("../models/AlumniProfile");
const Employee      = require("../models/Employee");

// ── Helper: calculate tenure ──────────────────────────────────
function calcTenure(joiningDate, relievingDate) {
  if (!joiningDate || !relievingDate) return "";
  const ms      = new Date(relievingDate) - new Date(joiningDate);
  const months  = Math.floor(ms / (1000 * 60 * 60 * 24 * 30.44));
  const years   = Math.floor(months / 12);
  const remMon  = months % 12;
  if (years === 0) return `${remMon} month${remMon !== 1 ? "s" : ""}`;
  if (remMon === 0) return `${years} year${years !== 1 ? "s" : ""}`;
  return `${years} year${years !== 1 ? "s" : ""} ${remMon} month${remMon !== 1 ? "s" : ""}`;
}

// ── POST /api/alumni  ─────────────────────────────────────────
// Called when employee is relieved/resigned (offboarding)
const createAlumni = async (req, res) => {
  try {
    const {
      employeeId, relievingDate, exitReason,
      linkedIn, currentCompany, currentRole, currentCity,
      isRehireEligible, hrNotes, tags,
    } = req.body;

    if (!employeeId) return res.status(400).json({ success: false, message: "employeeId required" });

    // Check if already alumni
    const exists = await AlumniProfile.findOne({ employeeId });
    if (exists) return res.status(409).json({ success: false, message: "Alumni profile already exists" });

    const emp = await Employee.findById(employeeId);
    if (!emp) return res.status(404).json({ success: false, message: "Employee not found" });

    const tenure = calcTenure(emp.joiningDate || emp.createdAt, relievingDate);

    const alumni = await AlumniProfile.create({
      employeeId,
      name:          emp.name,
      email:         emp.email || emp.personalEmail || "",
      phone:         emp.phone || emp.mobile || "",
      department:    emp.department || "",
      designation:   emp.designation || "",
      joiningDate:   emp.joiningDate || emp.createdAt,
      relievingDate: relievingDate || new Date(),
      tenure,
      exitReason:    exitReason || "resignation",
      linkedIn:      linkedIn || "",
      currentCompany: currentCompany || "",
      currentRole:   currentRole || "",
      currentCity:   currentCity || "",
      isRehireEligible: isRehireEligible !== undefined ? isRehireEligible : true,
      hrNotes:       hrNotes || "",
      tags:          tags || [],
    });

    // Mark employee as inactive/alumni in Employee collection
    await Employee.findByIdAndUpdate(employeeId, {
      $set: { status: "alumni", relievingDate: relievingDate || new Date() }
    });

    await alumni.populate("employeeId", "name department designation");
    res.status(201).json({ success: true, data: alumni, message: "Alumni profile created" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/alumni  ──────────────────────────────────────────
const getAllAlumni = async (req, res) => {
  try {
    const { status, department, rehire, search } = req.query;
    const filter = {};

    if (status)     filter.networkStatus = status;
    if (department) filter.department    = department;
    if (rehire === "true") filter.isRehireEligible = true;
    if (search) {
      filter.$or = [
        { name:           { $regex: search, $options: "i" } },
        { email:          { $regex: search, $options: "i" } },
        { department:     { $regex: search, $options: "i" } },
        { designation:    { $regex: search, $options: "i" } },
        { currentCompany: { $regex: search, $options: "i" } },
      ];
    }

    const alumni = await AlumniProfile.find(filter)
      .sort({ relievingDate: -1 })
      .populate("employeeId", "name department designation");

    res.json({ success: true, data: alumni, total: alumni.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/alumni/stats  ────────────────────────────────────
const getAlumniStats = async (req, res) => {
  try {
    const total       = await AlumniProfile.countDocuments();
    const active      = await AlumniProfile.countDocuments({ networkStatus: "active" });
    const inactive    = await AlumniProfile.countDocuments({ networkStatus: "inactive" });
    const optedOut    = await AlumniProfile.countDocuments({ networkStatus: "opted_out" });
    const rehireReady = await AlumniProfile.countDocuments({ isRehireEligible: true });
    const ambassadors = await AlumniProfile.countDocuments({ isBrandAmbassador: true });
    const mentors     = await AlumniProfile.countDocuments({ mentorshipAvailable: true });

    // Referral stats
    const alumniWithReferrals = await AlumniProfile.find({ "referrals.0": { $exists: true } });
    const totalReferrals  = alumniWithReferrals.reduce((acc, a) => acc + (a.referrals?.length || 0), 0);
    const converted       = alumniWithReferrals.reduce((acc, a) => acc + (a.referrals?.filter(r => r.status === "converted").length || 0), 0);

    // Dept breakdown
    const deptPipeline = await AlumniProfile.aggregate([
      { $group: { _id: "$department", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    res.json({
      success: true,
      data: {
        total, active, inactive, optedOut,
        rehireReady, ambassadors, mentors,
        referrals: { total: totalReferrals, converted },
        byDepartment: deptPipeline,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/alumni/:id  ──────────────────────────────────────
const getAlumniById = async (req, res) => {
  try {
    const alumni = await AlumniProfile.findById(req.params.id)
      .populate("employeeId", "name department designation joiningDate")
      .populate("mentorshipSessions.menteeId", "name department");
    if (!alumni) return res.status(404).json({ success: false, message: "Alumni not found" });
    res.json({ success: true, data: alumni });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/alumni/:id  ──────────────────────────────────────
const updateAlumni = async (req, res) => {
  try {
    const alumni = await AlumniProfile.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    ).populate("employeeId", "name department designation");
    if (!alumni) return res.status(404).json({ success: false, message: "Alumni not found" });
    res.json({ success: true, data: alumni, message: "Alumni profile updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/alumni/:id/engagement  ─────────────────────────
const addEngagement = async (req, res) => {
  try {
    const { type, note, addedBy } = req.body;
    if (!note) return res.status(400).json({ success: false, message: "Note required" });

    const alumni = await AlumniProfile.findByIdAndUpdate(
      req.params.id,
      { $push: { engagementLog: { type: type || "other", note, addedBy: addedBy || "HR", date: new Date() } } },
      { new: true }
    );
    if (!alumni) return res.status(404).json({ success: false, message: "Alumni not found" });
    res.json({ success: true, data: alumni, message: "Engagement logged" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/alumni/:id/referral  ───────────────────────────
const addReferral = async (req, res) => {
  try {
    const { type, name, contactInfo, notes } = req.body;
    if (!name) return res.status(400).json({ success: false, message: "Referral name required" });

    const alumni = await AlumniProfile.findByIdAndUpdate(
      req.params.id,
      { $push: { referrals: { type: type || "candidate", name, contactInfo: contactInfo || "", notes: notes || "", date: new Date() } } },
      { new: true }
    );
    if (!alumni) return res.status(404).json({ success: false, message: "Alumni not found" });
    res.json({ success: true, data: alumni, message: "Referral added" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PUT /api/alumni/:id/referral/:refId  ─────────────────────
const updateReferralStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const alumni = await AlumniProfile.findOneAndUpdate(
      { _id: req.params.id, "referrals._id": req.params.refId },
      { $set: { "referrals.$.status": status } },
      { new: true }
    );
    if (!alumni) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: alumni, message: "Referral status updated" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/alumni/:id/mentorship-session  ─────────────────
const addMentorshipSession = async (req, res) => {
  try {
    const { menteeId, menteeName, notes } = req.body;
    const alumni = await AlumniProfile.findByIdAndUpdate(
      req.params.id,
      { $push: { mentorshipSessions: { menteeId: menteeId || null, menteeName: menteeName || "", notes: notes || "", date: new Date() } } },
      { new: true }
    );
    if (!alumni) return res.status(404).json({ success: false, message: "Alumni not found" });
    res.json({ success: true, data: alumni, message: "Mentorship session logged" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

module.exports = {
  createAlumni, getAllAlumni, getAlumniStats,
  getAlumniById, updateAlumni,
  addEngagement, addReferral, updateReferralStatus,
  addMentorshipSession,
};