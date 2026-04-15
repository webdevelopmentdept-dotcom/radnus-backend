const mongoose = require('mongoose');

const kpiActualSchema = new mongoose.Schema({
  assignment_id: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'KpiAssignment', 
    required: true 
  },
  kpi_item_id: { 
    type: String,   // subdocument _id from kpi_items array
    required: true 
  },
  actual_value: { 
    type: Number, 
    required: true 
  },
  entered_by: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'HR' 
  }
}, { timestamps: true });

module.exports = mongoose.model('KpiActual', kpiActualSchema);