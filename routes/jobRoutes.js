const express = require("express");
const router = express.Router();
const Job = require("../models/Job");
const Notification = require("../models/Notification");
const Employee = require("../models/Employee");
const HR_ID = "hr_admin_001";   

// HR — all jobs
router.get("/", async (req, res) => {
  try {
    const jobs = await Job.find().sort({ posted: -1 });
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Create job
router.post("/", async (req, res) => {
  try {
    const job = new Job(req.body);
    await job.save();
    res.json({ success: true, msg: "Job created!", job });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Update job (edit + status change)
router.put("/:id", async (req, res) => {
  try {
    const updated = await Job.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!updated) return res.status(404).json({ success: false, msg: "Not found" });
    res.json({ success: true, msg: "Job updated!", job: updated });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Delete job
router.delete("/:id", async (req, res) => {
  try {
    await Job.findByIdAndDelete(req.params.id);
    res.json({ success: true, msg: "Job deleted!" });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Employee dashboard — internal active jobs only
router.get("/internal", async (req, res) => {
  try {
    const jobs = await Job.find({ status: "active", visibility: "internal" })
      .select("title type experience salary description requirements responsibilities applicants")
      .sort({ posted: -1 });
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});


router.get("/public", async (req, res) => {
  try {
    const jobs = await Job.find({ status: "active", visibility: "public" }).sort({ posted: -1 });
    res.json({ success: true, jobs });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});


// Employee — get all jobs this employee applied to (status tracking)
router.get("/my-applications/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;

    const jobs = await Job.find({ "applicants.employeeId": employeeId })
      .select("title type experience salary visibility status posted applicants")
      .sort({ posted: -1 });

    const applications = jobs.map((job) => {
      const applicant = job.applicants.find(
        (a) => a.employeeId?.toString() === employeeId.toString()
      );
      return {
        jobId: job._id,
        title: job.title,
        department: job.type,
        experience: job.experience,
        salary: job.salary,
        jobStatus: job.status,       // active / closed / draft (job itself)
        appliedAt: applicant?.appliedAt,
        applicationStatus: applicant?.status || "applied", // applied/under_review/interview/selected/rejected
        rejectionReason: applicant?.rejectionReason || null,
      };
    });

    res.json({ success: true, applications });
  } catch (err) {
    console.error("Error fetching my-applications:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Employee applies for internal job
router.post("/:id/apply", async (req, res) => {
  try {
    const { employeeId } = req.body;
    if (!employeeId) return res.status(400).json({ success: false, msg: "employeeId required" });

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, msg: "Job not found" });
    if (job.visibility !== "internal") return res.status(403).json({ success: false, msg: "Not an internal job" });

    const alreadyApplied = (job.applicants || []).some(
      (a) => a.employeeId?.toString() === employeeId.toString()
    );
    if (alreadyApplied) return res.status(409).json({ success: false, msg: "Already applied" });

    await Job.findByIdAndUpdate(req.params.id, {
      $push: { applicants: { employeeId, appliedAt: new Date(), status: "applied" } }
    });

    // ✅ NEW
    try {
      const emp = await Employee.findById(employeeId).select("name employeeId");
      await Notification.create({
        recipient_id:   HR_ID,
        recipient_role: "hr",
        type:           "new_applicant",
        title:          "New Internal Application",
        message:        `${emp?.name || "An employee"} applied for "${job.title}"`,
        link:           "",
        isRead:         false,
      });
    } catch (notifErr) {
      console.error("Notify HR (internal apply) failed:", notifErr.message);
    }

    res.json({ success: true, msg: "Application submitted!" });
  } catch (err) {
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// HR updates an internal applicant's status
router.put("/:id/applicant-status", async (req, res) => {
  try {
    const { employeeId, status, rejectionReason } = req.body;
    if (!employeeId || !status) {
      return res.status(400).json({ success: false, msg: "employeeId and status required" });
    }

    const job = await Job.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, msg: "Job not found" });

    const applicant = (job.applicants || []).find(
      (a) => a.employeeId?.toString() === employeeId.toString()
    );
    if (!applicant) {
      return res.status(404).json({ success: false, msg: "Applicant not found on this job" });
    }

    applicant.status = status;
    applicant.rejectionReason = rejectionReason || undefined;

    await job.save();

    try {
      const statusLabelMap = {
        applied:      "Applied",
        under_review: "Shortlisted",
        interview:    "Interview Scheduled",
        selected:     "Hired 🎉",
        rejected:     "Rejected",
      };
      const label = statusLabelMap[status] || status;
      const msg = status === "rejected" && rejectionReason
        ? `Your application for "${job.title}" was rejected. Reason: ${rejectionReason}`
        : `Your application status for "${job.title}" is now: ${label}`;

      await Notification.create({
        recipient_id:   String(employeeId),
        recipient_role: "employee",
        type:           "hr",
        title:          "Application Status Updated",
        message:        msg,
        link:           "",
        isRead:         false,
      });
    } catch (notifErr) {
      console.error("Notify employee (status update) failed:", notifErr.message);
    } 

    res.json({ success: true, msg: "Applicant status updated!" });
  } catch (err) {
    console.error("Error updating applicant status:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// HR removes an internal applicant from a job
router.delete("/:id/applicant/:employeeId", async (req, res) => {
  try {
    const { id, employeeId } = req.params;
    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ success: false, msg: "Job not found" });

    job.applicants = (job.applicants || []).filter(
      (a) => a.employeeId?.toString() !== employeeId.toString()
    );

    await job.save();
    res.json({ success: true, msg: "Applicant removed!" });
  } catch (err) {
    console.error("Error removing internal applicant:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

// Employee withdraws their own application — only allowed while status is "applied"
router.delete("/:id/withdraw/:employeeId", async (req, res) => {
  try {
    const { id, employeeId } = req.params;
    const job = await Job.findById(id);
    if (!job) return res.status(404).json({ success: false, msg: "Job not found" });

    const applicant = (job.applicants || []).find(
      (a) => a.employeeId?.toString() === employeeId.toString()
    );
    if (!applicant) {
      return res.status(404).json({ success: false, msg: "You haven't applied for this job" });
    }
    if (applicant.status !== "applied") {
      return res.status(403).json({
        success: false,
        msg: "Cannot withdraw — HR has already started reviewing this application",
      });
    }

    job.applicants = (job.applicants || []).filter(
      (a) => a.employeeId?.toString() !== employeeId.toString()
    );
    await job.save();

    res.json({ success: true, msg: "Application withdrawn" });
  } catch (err) {
    console.error("Error withdrawing application:", err);
    res.status(500).json({ success: false, msg: "Server error" });
  }
});

module.exports = router;

module.exports = router;