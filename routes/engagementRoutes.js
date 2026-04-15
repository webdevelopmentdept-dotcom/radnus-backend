const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");

// ── Schema ──────────────────────────────────────────────────────────────────
const engagementSchema = new mongoose.Schema({
  month: { type: String, required: true },
  month_number: { type: Number, required: true }, // 1-12 for sorting
  theme: { type: String, required: true },
  event_highlights: [{ type: String }],
  owner_department: { type: String },
  category: {
    type: String,
    enum: ["Fun & Celebration", "Learning & Knowledge Sharing", "Health & Wellness", "CSR & Social Responsibility", "Team Outings & Offsites", "Annual Mega Events"],
    default: "Fun & Celebration"
  },
  frequency: {
    type: String,
    enum: ["Monthly", "Bi-Monthly", "Quarterly", "Bi-Annual", "Yearly"],
    default: "Monthly"
  },
  status: { type: String, enum: ["upcoming", "ongoing", "completed"], default: "upcoming" },
  budget: { type: Number, default: 0 },
  notes: { type: String, default: "" },
  created_at: { type: Date, default: Date.now }
});

const Engagement = mongoose.model("Engagement", engagementSchema);

// ── Seed Data (from document) ────────────────────────────────────────────────
const SEED_DATA = [
  {
    month: "January", month_number: 1,
    theme: "New Beginnings Month",
    event_highlights: ["New Year Kickoff Meet", "Vision & Goal Setting Workshop", '"My 2026 Dream Board" Activity'],
    owner_department: "HR & Admin",
    category: "Fun & Celebration", frequency: "Monthly", status: "completed"
  },
  {
    month: "February", month_number: 2,
    theme: "Team Spirit Month",
    event_highlights: ["Team Bonding Games", "Sports Day", '"Best Team Collaboration" Award'],
    owner_department: "HR + Operations",
    category: "Fun & Celebration", frequency: "Monthly", status: "completed"
  },
  {
    month: "March", month_number: 3,
    theme: "Learning & Growth Month",
    event_highlights: ["Knowledge Week", "Internal Faculty Sharing Sessions", "Certification Recognition"],
    owner_department: "L&D + HR",
    category: "Learning & Knowledge Sharing", frequency: "Bi-Monthly", status: "completed"
  },
  {
    month: "April", month_number: 4,
    theme: "Wellness & Mindfulness Month",
    event_highlights: ["Yoga Session", "Health Camp", "Nutrition Talk", "Stress-Buster Games"],
    owner_department: "HR + CSR",
    category: "Health & Wellness", frequency: "Quarterly", status: "ongoing"
  },
  {
    month: "May", month_number: 5,
    theme: "Innovation Month",
    event_highlights: ["Idea Hackathon", "Product Improvement Challenge", '"Impact Bonus" Announcements'],
    owner_department: "Innovation Cell + HR",
    category: "Learning & Knowledge Sharing", frequency: "Bi-Monthly", status: "upcoming"
  },
  {
    month: "June", month_number: 6,
    theme: "Family & Gratitude Month",
    event_highlights: ["Family Day", "Employee Appreciation Week", '"Thank You Wall" Messages'],
    owner_department: "HR & Admin",
    category: "Fun & Celebration", frequency: "Monthly", status: "upcoming"
  },
  {
    month: "July", month_number: 7,
    theme: "Radnus Foundation Day",
    event_highlights: ["Annual Celebration", "Awards Night", '"22 Years of Excellence" Showcase'],
    owner_department: "CEO Office + HR",
    category: "Annual Mega Events", frequency: "Yearly", status: "upcoming"
  },
  {
    month: "August", month_number: 8,
    theme: "Patriotism & Social Impact Month",
    event_highlights: ["Independence Day Celebration", "Community Service Drive"],
    owner_department: "CSR & HR",
    category: "CSR & Social Responsibility", frequency: "Quarterly", status: "upcoming"
  },
  {
    month: "September", month_number: 9,
    theme: "Leadership & Mentorship Month",
    event_highlights: ["Leadership Talks", "Mentor-Mentee Meet", '"Leaders of Tomorrow" Recognition'],
    owner_department: "HR + Leadership Council",
    category: "Learning & Knowledge Sharing", frequency: "Bi-Monthly", status: "upcoming"
  },
  {
    month: "October", month_number: 10,
    theme: "Festive & Cultural Month",
    event_highlights: ["Traditional Day", "Ethnic Dress Competition", "Diwali Celebration"],
    owner_department: "HR + Admin",
    category: "Fun & Celebration", frequency: "Monthly", status: "upcoming"
  },
  {
    month: "November", month_number: 11,
    theme: "Fun @ Work Month",
    event_highlights: ["Indoor Games Week", "Meme Contest", '"Radnus Got Talent" Event'],
    owner_department: "HR + Event Team",
    category: "Fun & Celebration", frequency: "Monthly", status: "upcoming"
  },
  {
    month: "December", month_number: 12,
    theme: "Reflection & Rewards Month",
    event_highlights: ["Year-End Town Hall", "Annual Review Meet", '"Star of the Year" Awards'],
    owner_department: "HR + All Dept. Heads",
    category: "Annual Mega Events", frequency: "Yearly", status: "upcoming"
  }
];

// ── GET all ──────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  try {
    const { category, status, month } = req.query;
    const filter = {};
    if (category && category !== "All") filter.category = category;
    if (status   && status   !== "All") filter.status   = status;
    if (month    && month    !== "All") filter.month    = month;

    const data = await Engagement.find(filter).sort({ month_number: 1 });
    res.json({ success: true, data });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET summary stats ────────────────────────────────────────────────────────
router.get("/summary", async (req, res) => {
  try {
    const total     = await Engagement.countDocuments();
    const upcoming  = await Engagement.countDocuments({ status: "upcoming" });
    const ongoing   = await Engagement.countDocuments({ status: "ongoing" });
    const completed = await Engagement.countDocuments({ status: "completed" });
    res.json({ success: true, data: { total, upcoming, ongoing, completed } });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET single ───────────────────────────────────────────────────────────────
router.get("/:id", async (req, res) => {
  try {
    const item = await Engagement.findById(req.params.id);
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: item });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST create ──────────────────────────────────────────────────────────────
router.post("/", async (req, res) => {
  try {
    const item = new Engagement(req.body);
    await item.save();
    res.status(201).json({ success: true, data: item, message: "Event created!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── PUT update ───────────────────────────────────────────────────────────────
router.put("/:id", async (req, res) => {
  try {
    const item = await Engagement.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: item, message: "Updated!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── PATCH status only ────────────────────────────────────────────────────────
router.patch("/:id/status", async (req, res) => {
  try {
    const item = await Engagement.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!item) return res.status(404).json({ success: false, message: "Not found" });
    res.json({ success: true, data: item, message: "Status updated!" });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────
router.delete("/:id", async (req, res) => {
  try {
    await Engagement.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Deleted!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── SEED route (run once) ────────────────────────────────────────────────────
router.post("/seed/init", async (req, res) => {
  try {
    await Engagement.deleteMany({});
    await Engagement.insertMany(SEED_DATA);
    res.json({ success: true, message: "Seeded 12 months of engagement data!" });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;