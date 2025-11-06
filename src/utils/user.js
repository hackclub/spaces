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

export const checkUserSpaceLimit = async (userId) => {
  if (!userId) {
    throw new Error("User ID is required");
  }

  try {
    const user = await pg('users')
      .where('id', userId)
      .first();

    if (!user) {
      throw new Error("User not found");
    }

    const userSpaces = await pg('spaces')
      .where('user_id', userId)
      .count('id as count')
      .first();
    
    const currentSpaceCount = parseInt(userSpaces.count) || 0;
    const maxSpaces = user.max_spaces ?? 3;
    
    if (currentSpaceCount >= maxSpaces) {
      const error = new Error(`Maximum space limit reached (${maxSpaces} spaces)`);
      error.statusCode = 403;
      throw error;
    }

    return {
      currentSpaceCount,
      maxSpaces,
      canCreateSpace: currentSpaceCount < maxSpaces
    };
  } catch (error) {
    console.error('Error checking space limit:', error);
    throw error;
  }
};