import Airtable from 'airtable';
import crypto from 'crypto';
import dotenv from 'dotenv';
import pg from './db.js';

dotenv.config();


const airtable = new Airtable({
  apiKey: process.env.AIRTABLE_API_KEY,
});

const base = airtable.base(process.env.AIRTABLE_BASE_ID);

export const getAllRecords = async (tableName) => {
  try {
    const records = await base(tableName).select().all();
    return records.map(record => ({
      id: record.id,
      fields: record.fields,
      createdTime: record._rawJson.createdTime
    }));
  } catch (error) {
    console.error(`Error fetching records from ${tableName}:`, error);
    throw error;
  }
};

export const createRecord = async (tableName, fields) => {
  try {
    const record = await base(tableName).create(fields);
    return {
      id: record.id,
      fields: record.fields,
      createdTime: record._rawJson.createdTime
    };
  } catch (error) {
    console.error(`Error creating record in ${tableName}:`, error);
    throw error;
  }
};

export const updateRecord = async (tableName, recordId, fields) => {
  try {
    const record = await base(tableName).update(recordId, fields);
    return {
      id: record.id,
      fields: record.fields,
      createdTime: record._rawJson.createdTime
    };
  } catch (error) {
    console.error(`Error updating record in ${tableName}:`, error);
    throw error;
  }
};

export const deleteRecord = async (tableName, recordId) => {
  try {
    const deletedRecord = await base(tableName).destroy(recordId);
    return { id: deletedRecord.id, deleted: true };
  } catch (error) {
    console.error(`Error deleting record from ${tableName}:`, error);
    throw error;
  }
};

export const findRecords = async (tableName, filterFormula = '', sort = []) => {
  try {
    const records = await base(tableName).select({
      filterByFormula: filterFormula,
      sort: sort
    }).all();
    
    return records.map(record => ({
      id: record.id,
      fields: record.fields,
      createdTime: record._rawJson.createdTime
    }));
  } catch (error) {
    console.error(`Error finding records in ${tableName}:`, error);
    throw error;
  }
};

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const SEND_COOLDOWN_MS = 60 * 1000;
const MAX_SENDS_PER_HOUR = 5;

const normalizeCodeEmail = (email) => String(email || '').trim().toLowerCase();

export const sendEmail = async (email) => {
  const normalized = normalizeCodeEmail(email);

  const recentSends = await pg('verification_codes')
    .where('email', normalized)
    .where('created_at', '>', new Date(Date.now() - 60 * 60 * 1000))
    .orderBy('created_at', 'desc')
    .select('created_at');

  const lastSent = recentSends[0] ? new Date(recentSends[0].created_at).getTime() : 0;
  if (recentSends.length >= MAX_SENDS_PER_HOUR || Date.now() - lastSent < SEND_COOLDOWN_MS) {
    const error = new Error('Too many verification codes requested. Please wait a minute and try again.');
    error.statusCode = 429;
    throw error;
  }

  const code = crypto.randomInt(100000, 1000000);
  const record = await createRecord('Spaces Emails', {
    email: normalized,
    code
  });

  await pg('verification_codes').insert({
    email: normalized,
    airtable_record_id: record.id
  });

  return {
    success: true,
    email: normalized
  };
};

export const checkEmail = async (email, codeToCheck) => {
  const normalized = normalizeCodeEmail(email);

  const latest = await pg('verification_codes')
    .where('email', normalized)
    .orderBy('created_at', 'desc')
    .first();

  if (!latest || latest.used_at || Date.now() - new Date(latest.created_at).getTime() > CODE_TTL_MS) {
    return false;
  }

  const [counted] = await pg('verification_codes')
    .where('id', latest.id)
    .whereNull('used_at')
    .where('attempts', '<', MAX_ATTEMPTS)
    .update({ attempts: pg.raw('attempts + 1') })
    .returning(['id']);

  if (!counted) {
    return false;
  }

  const record = await base('Spaces Emails').find(latest.airtable_record_id);
  if (String(record.fields.code) !== String(codeToCheck)) {
    return false;
  }

  const [used] = await pg('verification_codes')
    .where('id', latest.id)
    .whereNull('used_at')
    .update({ used_at: new Date() })
    .returning(['id']);

  return Boolean(used);
};

export { base };
export default airtable;