import pg from './db.js';
import { findSessionUser } from './sessions.js';

export const getUser = async (authorization) => {
  if (!authorization) return null;

  try {
    const user = await findSessionUser(authorization);

    return user;
  } catch (error) {
    
    console.error('Error fetching user:', error);
    throw error;
  }
};

export const getUserFromRequest = async (req) => {
  const authHeader = req.headers.authorization;
  const authCookie = req.cookies?.auth_token;
  const authorization = authHeader || authCookie;
  
  if (!authorization) return null;
  
  return getUser(authorization);
};

export const ensureHackclubVerified = async (user) => {
  if (!user) {
    throw new Error("User is required");
  }

  const validStatuses = ['verified', 'verified_eligible', 'verified_but_over_18'];
  
  if (validStatuses.includes(user.hackclub_verification_status)) {
    const lastChecked = user.hackclub_last_checked_at;
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    if (lastChecked && new Date(lastChecked) > oneHourAgo) {
      return user.hackclub_verification_status;
    }
  }

  try {
    const response = await fetch(
      `https://auth.hackclub.com/api/external/check?email=${encodeURIComponent(user.email)}`
    );

    if (!response.ok) {
      if (validStatuses.includes(user.hackclub_verification_status)) {
        return user.hackclub_verification_status;
      }
      return user.hackclub_verification_status || 'unknown';
    }

    const data = await response.json();
    const newStatus = data.result || 'not_found';

    await pg('users')
      .where({ id: user.id })
      .update({
        hackclub_verification_status: newStatus,
        hackclub_last_checked_at: new Date()
      });

    return newStatus;
  } catch (error) {
    console.error('Error checking Hack Club verification:', error);
    if (validStatuses.includes(user.hackclub_verification_status)) {
      return user.hackclub_verification_status;
    }
    return user.hackclub_verification_status || 'unknown';
  }
};
