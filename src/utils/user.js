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

export const updateUser = async (authorization, updateData) => {
  if (!authorization) {
    throw new Error("Authorization token is required");
  }

  try {
    const user = await pg('users')
      .where('authorization', authorization)
      .first();

    if (!user) {
      const error = new Error("User not found");
      error.statusCode = 404;
      throw error;
    }

    const updates = {};
    
    if (updateData.email !== undefined) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(updateData.email)) {
        const error = new Error("Invalid email format");
        error.statusCode = 400;
        throw error;
      }
      
      const existingEmail = await pg('users')
        .where('email', updateData.email)
        .whereNot('id', user.id)
        .first();
      
      if (existingEmail) {
        const error = new Error("Email already in use");
        error.statusCode = 409;
        throw error;
      }
      
      updates.email = updateData.email;
    }
    
    if (updateData.username !== undefined) {
      if (updateData.username.length > 100) {
        const error = new Error("Username must be 100 characters or less");
        error.statusCode = 400;
        throw error;
      }
      
      const existingUsername = await pg('users')
        .where('username', updateData.username)
        .whereNot('id', user.id)
        .first();
      
      if (existingUsername) {
        const error = new Error("Username already taken");
        error.statusCode = 409;
        throw error;
      }
      
      updates.username = updateData.username;
    }
    
    if (updateData.hackatime_api_key !== undefined) {
      updates.hackatime_api_key = updateData.hackatime_api_key;
    }

    if (Object.keys(updates).length === 0) {
      const error = new Error("No valid fields to update");
      error.statusCode = 400;
      throw error;
    }

    const [updatedUser] = await pg('users')
      .where('authorization', authorization)
      .update(updates)
      .returning(['id', 'email', 'username', 'hackatime_api_key']);

    return updatedUser;
  } catch (error) {
    console.error('Error updating user:', error);
    throw error;
  }
};