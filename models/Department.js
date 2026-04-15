const mongoose = require("mongoose");
 
const departmentSchema = new mongoose.Schema(
  {
    name:        { type:String, required:true, trim:true, unique:true },
    code:        { type:String, required:true, trim:true, unique:true, uppercase:true },
    head:        { type:String, trim:true, default:"" },
    description: { type:String, trim:true, default:"" },
    status:      { type:String, enum:["active","inactive"], default:"active" },
  },
  { timestamps:true }
);
 
departmentSchema.index({ status:1 });
module.exports = mongoose.model("Department", departmentSchema);