const HRDocumentSchema = new mongoose.Schema({
  employeeId:           { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  offerLetter:          { type: String },   // file path / S3 URL
  appointmentLetter:    { type: String },
  ndaAgreement:         { type: String },
  employmentContract:   { type: String },
  hrPolicy:             { type: String },
  salaryStructureDoc:   { type: String },
  uploadedBy:           { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

const HRDocument = mongoose.model("HRDocument", HRDocumentSchema);
