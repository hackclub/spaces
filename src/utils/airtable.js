import Airtable from 'airtable';
import dotenv from 'dotenv';

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

const genCode = () => {
  return Math.floor(100000 + Math.random() * 900000);
};

export const sendEmail = async (email) => {
  try {
    const code = genCode();
    const record = await createRecord('Spaces Emails', {
      email: email,
      code: code
    });
    
    return {
      success: true,
      recordId: record.id,
      code: code,
      email: email
    };
  } catch (error) {
    console.error(`Error sending email verification for ${email}:`, error);
    throw error;
  }
};

export const checkEmail = async (email, codeToCheck) => {
  try {
    const sanitizedEmail = email.replace(/["\\]/g, '');
    const filterFormula = `{email} = "${sanitizedEmail}"`;
    const records = await findRecords('Spaces Emails', filterFormula, [
      { field: 'Time Created', direction: 'desc' }
    ]);
    
    if (records.length === 0) {
      console.log(`No verification codes found for ${email}.`);
      return false;
    }
    
    const latestRecord = records[0];
    
    if (latestRecord.fields.code !== codeToCheck) {
      console.log(`Verification code for ${email} does not match.`);
      return false; 
    }
    
    const recordCreatedTime = new Date(latestRecord.createdTime);
    const currentTime = new Date();
    const timeDifferenceMinutes = (currentTime - recordCreatedTime) / (1000 * 60);
    
    if (timeDifferenceMinutes > 5) {
      console.log(`Verification code for ${email} has expired.`);
      return false;
    }
    
    return true; 
  } catch (error) {
    console.error(`Error checking email verification for ${email}:`, error);
    throw error;
  }
};

export { base };
export default airtable;