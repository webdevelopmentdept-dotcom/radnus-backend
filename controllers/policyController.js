const Policy = require("../models/Policy");
const PolicyAcknowledgement = require("../models/PolicyAcknowledgement");

// HR - Create new policy
exports.createPolicy = async (req, res) => {
  try {
    const { title, category, description, applicable_to, uploaded_by } = req.body;

    if (!req.file)
      return res.status(400).json({ message: "File required" });

    const file_url = req.file.path; // Cloudinary URL

    const policy = new Policy({
      title,
      category,
      description,
      file_url,
      applicable_to: applicable_to || "all",
      uploaded_by: uploaded_by || null,
      version: 1,
      // ✅ v1 entry goes into version_history on creation itself
      version_history: [{
        version_number: 1,
        file_url,
        uploaded_by: uploaded_by || null,
        change_note: "Initial upload",
        created_at: new Date(),
      }]
    });

    await policy.save();
    res.status(201).json({ message: "Policy created", policy });

  } catch (err) {
    console.log("CREATE POLICY ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// HR - Update policy (new version)
exports.updatePolicy = async (req, res) => {
  try {
    const { id } = req.params;
    const { title, category, description, change_note, uploaded_by } = req.body;

    const policy = await Policy.findById(id);
    if (!policy)
      return res.status(404).json({ message: "Policy not found" });

    if (req.file) {
      const newVersion = policy.version + 1;
      const newFileUrl = req.file.path; // Cloudinary URL

      // ✅ Push the NEW version into version_history
      policy.version_history.push({
        version_number: newVersion,
        file_url: newFileUrl,
        uploaded_by: uploaded_by || policy.uploaded_by,
        change_note: change_note || `Updated to v${newVersion}`,
        created_at: new Date(),
      });

      // Update current file pointer and version number
      policy.file_url = newFileUrl;
      policy.version = newVersion;

      // Reset all existing acknowledgements (employees must re-acknowledge new version)
      await PolicyAcknowledgement.updateMany(
        { policy_id: id },
        { is_current: false }
      );
    }

    if (title) policy.title = title;
    if (category) policy.category = category;
    if (description !== undefined) policy.description = description;

    await policy.save();
    res.json({ message: "Policy updated", policy });

  } catch (err) {
    console.log("UPDATE POLICY ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// Get all policies (includes version_history)
exports.getAllPolicies = async (req, res) => {
  try {
    const policies = await Policy.find({ is_active: true })
      .sort({ createdAt: -1 });

    res.json(policies);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// Employee - Acknowledge policy
exports.acknowledgePolicy = async (req, res) => {
  try {
    const { policy_id, employee_id } = req.body;

    if (!policy_id || !employee_id)
      return res.status(400).json({ message: "policy_id and employee_id required" });

    const policy = await Policy.findById(policy_id);
    if (!policy)
      return res.status(404).json({ message: "Policy not found" });

    const existing = await PolicyAcknowledgement.findOne({
      policy_id,
      employee_id,
      is_current: true
    });

    if (existing)
      return res.status(400).json({ message: "Already acknowledged" });

    await PolicyAcknowledgement.create({
      policy_id,
      employee_id,
      version_number: policy.version,
      is_current: true
    });

    res.json({ message: "Policy acknowledged" });

  } catch (err) {
    console.log("ACKNOWLEDGE ERROR:", err);
    res.status(500).json({ message: err.message });
  }
};

// HR - Get acknowledgement stats for a policy
exports.getPolicyStats = async (req, res) => {
  try {
    const { id } = req.params;
    const total = await PolicyAcknowledgement.countDocuments({
      policy_id: id,
      is_current: true
    });
    res.json({ acknowledged_count: total });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// HR - Soft delete
exports.deletePolicy = async (req, res) => {
  try {
    await Policy.findByIdAndUpdate(req.params.id, { is_active: false });
    res.json({ message: "Policy removed" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};