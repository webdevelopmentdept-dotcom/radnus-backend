// helpers/recognitionConfig.js
const RecognitionConfig = require('../models/RecognitionConfig');

async function getRecognitionConfig() {
  return RecognitionConfig.findOneAndUpdate(
    { key: 'main' }, { $setOnInsert: { key: 'main' } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  ).lean();
}
module.exports = { getRecognitionConfig };