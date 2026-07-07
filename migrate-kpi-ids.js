require('dotenv').config();
const mongoose = require('mongoose');
const KpiMonthlyVersion = require('./models/KpiMonthlyVersion');

async function migrate() {
  await mongoose.connect(process.env.MONGO_URI);

  // Use the native driver directly to see RAW data (no Mongoose defaults/virtuals)
  const collection = mongoose.connection.collection('kpimonthlyversions');
  const versions = await collection.find({}).toArray();

  console.log(`Found ${versions.length} month versions`);

  let updatedCount = 0;

  for (const v of versions) {
    let changed = false;

    const newItems = (v.kpi_items || []).map(item => {
      if (!item._id) {
        item._id = new mongoose.Types.ObjectId();
        changed = true;
      }
      return item;
    });

    if (changed) {
      await collection.updateOne(
        { _id: v._id },
        { $set: { kpi_items: newItems } }
      );
      updatedCount++;
      console.log(`Updated: ${v.month} (template: ${v.template_id})`);
    }
  }

  console.log(`\n✅ Migration done. ${updatedCount} of ${versions.length} versions updated.`);
  await mongoose.disconnect();
  process.exit(0);
}

migrate().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});