const express = require("express");
const router  = express.Router();
const {
  createPlan,
  getPlanByEmployee,
  getAllPlans,
  updatePlan,
  addReview,
  deletePlan,  
} = require("../controllers/retentionController");
 const auth = require("../middleware/auth"); 
 const hrOnly = require("../middleware/hrOnly"); 

router.get("/employee/:employeeId", getPlanByEmployee);

router.get("/", auth, hrOnly,                getAllPlans);
router.post("/", auth, hrOnly,               createPlan);
router.put("/:id", auth, hrOnly,             updatePlan);
router.delete("/:id", auth, hrOnly,              deletePlan); 
router.post("/:id/review", auth, hrOnly,     addReview); 

module.exports = router;