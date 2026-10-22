// helpers/lifeGrowthCrypto.js
// AES-256-GCM helpers for Life Growth money fields and private notes.
// Key: LIFE_GROWTH_ENC_KEY in .env (32 random bytes, base64).
// Generate one:  node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
const crypto = require('crypto');

const PREFIX = 'lg1';

function getKey() {
  const raw = process.env.LIFE_GROWTH_ENC_KEY;
  if (!raw) throw new Error('LIFE_GROWTH_ENC_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new Error('LIFE_GROWTH_ENC_KEY must be 32 bytes (base64)');
  return key;
}

// returns null for empty values so nothing is stored
function encrypt(value) {
  if (value === null || value === undefined || value === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getKey(), iv);
  const enc = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [PREFIX, iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':');
}

function decrypt(payload) {
  if (!payload) return null;
  const parts = String(payload).split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw new Error('Invalid encrypted value');
  const [, iv, tag, data] = parts;
  const decipher = crypto.createDecipheriv('aes-256-gcm', getKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };