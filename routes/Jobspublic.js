const express  = require("express");
const router   = express.Router();
const ShopOwner  = require("../models/ShopOwner");
const Technician = require("../models/Technician");
const Poster     = require("../models/Poster");

/* ─────────────────────────────────────────────
   GET /api/connect/jobs
   Public job board — only "Open" listings
───────────────────────────────────────────── */
router.get("/jobs", async (req, res) => {
  try {
    const {
      district, experience, jobType, search,
      page = 1, limit = 12,
    } = req.query;

    const filter = { jobStatus: "Open" };

    if (district) filter.district  = new RegExp(district, "i");
    if (jobType)  filter.jobType   = new RegExp(jobType, "i");
    if (experience && experience !== "All")
      filter.experience = experience;

    if (search) {
      filter.$or = [
        { shopName:       new RegExp(search, "i") },
        { district:       new RegExp(search, "i") },
        { skills:         new RegExp(search, "i") },
        { technicianTypes:{ $elemMatch: { $regex: search, $options: "i" } } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [jobs, total] = await Promise.all([
      ShopOwner.find(filter)
        .select(
          "shopName ownerName district taluk experience salaryRange jobType " +
          "technicianTypes skills machines jobStatus postedAt featured workingHours foodAccommodation"
        )
        .sort({ featured: -1, postedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      ShopOwner.countDocuments(filter),
    ]);

    // Increment view counts
    const ids = jobs.map((j) => j._id);
    ShopOwner.updateMany({ _id: { $in: ids } }, { $inc: { viewCount: 1 } }).exec();

    res.json({ jobs, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    console.error("Jobs public error:", err);
    res.status(500).json({ success: false });
  }
});

/* ─────────────────────────────────────────────
   GET /api/connect/technicians
   Public board — only "Available" technicians
───────────────────────────────────────────── */
router.get("/technicians", async (req, res) => {
  try {
    const {
      district, experience, skill, search,
      page = 1, limit = 12,
    } = req.query;

    const filter = { availabilityStatus: "Available" };

    if (district)   filter.district   = new RegExp(district, "i");
    if (experience && experience !== "All") filter.experience = experience;
    if (skill)      filter.skills     = { $elemMatch: { $regex: skill, $options: "i" } };

    if (search) {
      filter.$or = [
        { fullName: new RegExp(search, "i") },
        { district: new RegExp(search, "i") },
        { skills:   { $elemMatch: { $regex: search, $options: "i" } } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    const [technicians, total] = await Promise.all([
      Technician.find(filter)
        .select(
          "fullName district taluk experience skills brands " +
          "expectedSalary jobType availabilityStatus featured publishedAt"
        )
        .sort({ featured: -1, publishedAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      Technician.countDocuments(filter),
    ]);

    // Track profile views
    const ids = technicians.map((t) => t._id);
    Technician.updateMany({ _id: { $in: ids } }, { $inc: { profileViews: 1 } }).exec();

    res.json({ technicians, total, pages: Math.ceil(total / Number(limit)) });
  } catch (err) {
    console.error("Technicians public error:", err);
    res.status(500).json({ success: false });
  }
});

/* ─────────────────────────────────────────────
   GET /api/connect/posters
   Active posters for sidebar carousel
───────────────────────────────────────────── */
router.get("/posters", async (req, res) => {
  try {
    const filter = { isActive: true };
    if (req.query.type) filter.type = req.query.type;
    const posters = await Poster.find(filter).sort({
      displayOrder: 1,
      createdAt: -1,
    });
    res.json(posters);
  } catch {
    res.status(500).json({ success: false });
  }
});
/* ─────────────────────────────────────────────
   GET /api/connect/stats
   Live counts for homepage display
───────────────────────────────────────────── */
router.get("/stats", async (req, res) => {
  try {
    const [openJobs, availableTechs, totalTechs, totalShops] = await Promise.all([
      ShopOwner.countDocuments({ jobStatus: "Open" }),
      Technician.countDocuments({ availabilityStatus: "Available" }),
      Technician.countDocuments({ availabilityStatus: { $ne: "Archived" } }),
      ShopOwner.countDocuments({ jobStatus: { $ne: "Archived" } }),
    ]);
    res.json({ openJobs, availableTechs, totalTechs, totalShops });
  } catch {
    res.status(500).json({ success: false });
  }
});

module.exports = router;