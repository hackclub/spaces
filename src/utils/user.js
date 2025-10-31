import airtable from './airtable.js';
import pg from './db.js';

export const getUser = async (authorization) => {
  try {
    const user = await pg('users')
      .where('authorization', authorization)
      .first();

    return user;
  } catch (error) {
    
    console.error('Error fetching user:', error);
    throw error;
  }
};