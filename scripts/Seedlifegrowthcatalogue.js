// scripts/seedLifeGrowthCatalogue.js
// Creates the 25 standard Life Growth goal options (5 per stage).
// Safe to run more than once: options that already exist (same stage + title) are skipped.
// Run from the backend folder:   node scripts/seedLifeGrowthCatalogue.js
require('dotenv').config();
const mongoose = require('mongoose');
const LifeGoalCatalogue = require('../models/Lifegoalcatalogue');
const { STAGES } = require('../helpers/lifeGrowthValidators');

const OPTIONS = {
  1: [
    ['Build an emergency cash reserve', 'Set aside cash for unexpected expenses.', 'Financial Stability'],
    ['Close a small debt or overdue balance', 'Clear a small debt or overdue amount.', 'Debt Reduction'],
    ['Save towards or purchase a basic bike', 'Save for, or buy, a basic bike.', 'Personal Assets'],
    ['Purchase a small amount of gold or jewellery', 'Buy a small amount of gold or jewellery.', 'Gold and Jewellery'],
    ['Build a regular cash savings balance', 'Build the habit of saving a fixed amount regularly.', 'Savings'],
  ],
  2: [
    ['Build a larger emergency savings fund', 'Grow your emergency fund to cover a longer period.', 'Financial Stability'],
    ['Work towards purchasing 10 grams of gold', 'Save towards buying 10 grams of gold.', 'Gold and Jewellery'],
    ['Reduce or close remaining personal debt', 'Reduce or fully clear any remaining personal debt.', 'Debt Reduction'],
    ['Purchase a two-wheeler if not already achieved', 'Buy a two-wheeler if you do not have one yet.', 'Personal Assets'],
    ['Save towards professional education or certification', 'Fund a course or certification that helps your career.', 'Education'],
  ],
  3: [
    ['Build a fund towards purchasing a small plot of land', 'Save steadily towards a small plot of land.', 'Personal Assets'],
    ['Save towards a future home down payment', 'Build a down payment fund for a future home.', 'Personal Assets'],
    ['Start a car purchase fund', 'Begin saving towards buying a car.', 'Personal Assets'],
    ['Build capital for a small business', 'Save starting capital for a small business.', 'Entrepreneurship'],
    ['Start a suitable long-term investment habit', 'Start investing a small amount regularly, in a way that suits you.', 'Investments'],
  ],
  4: [
    ['Work towards purchasing land or building a house', 'Make progress towards land or a house.', 'Personal Assets'],
    ['Purchase a car if financially affordable', 'Buy a car if it fits your finances.', 'Personal Assets'],
    ['Expand a personal business or income source', 'Grow a personal business or an additional income source.', 'Entrepreneurship'],
    ['Fund advanced education or a major qualification', 'Pay for advanced studies or a major qualification.', 'Education'],
    ['Build a stronger savings and investment portfolio', 'Strengthen your savings and investments.', 'Investments'],
  ],
  5: [
    ['Build a long-term investment portfolio', 'Build a diversified long-term investment portfolio.', 'Investments'],
    ['Purchase property or progress towards home ownership', 'Buy property or move closer to owning a home.', 'Personal Assets'],
    ['Achieve a major vehicle ownership goal', 'Reach a larger vehicle ownership goal.', 'Personal Assets'],
    ['Build or expand a business', 'Start or grow a business.', 'Entrepreneurship'],
    ['Work towards financial independence and retirement savings', 'Plan for financial independence and retirement.', 'Financial Stability'],
  ],
};

(async () => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is not set');
  await mongoose.connect(process.env.MONGO_URI);
  let created = 0;
  let skipped = 0;
  for (const stage of STAGES) {
    const list = OPTIONS[stage.stage_number];
    for (let i = 0; i < list.length; i += 1) {
      const [goal_title, goal_description, goal_category] = list[i];
      const exists = await LifeGoalCatalogue.findOne({ stage_number: stage.stage_number, goal_title });
      if (exists) { skipped += 1; continue; }
      await LifeGoalCatalogue.create({
        stage_number: stage.stage_number,
        stage_name: stage.stage_name,
        goal_title,
        goal_description,
        goal_category,
        display_order: i + 1,
        is_active: true,
        updated_by: 'seed',
      });
      created += 1;
    }
  }
  console.log(`Life Growth catalogue: ${created} created, ${skipped} already existed`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e.message); process.exit(1); });