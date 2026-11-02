import crypto from 'crypto';
import pg from './db.js';

export const SESSION_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const createSession = async (userId) => {
  const token = crypto.randomBytes(32).toString('hex');

  await pg('sessions')
    .where('user_id', userId)
    .where('expires_at', '<', new Date())
    .delete();

  await pg('sessions').insert({
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: new Date(Date.now() + SESSION_MAX_AGE)
  });

  return token;
};

export const findSessionUser = async (token) => {
  if (!token) return null;

  return pg('users')
    .join('sessions', 'sessions.user_id', 'users.id')
    .where('sessions.token_hash', hashToken(token))
    .where('sessions.expires_at', '>', new Date())
    .first('users.*');
};

export const deleteSession = async (token) => {
  if (!token) return;
  await pg('sessions').where('token_hash', hashToken(token)).delete();
};

export const deleteExpiredSessions = () => pg('sessions').where('expires_at', '<', new Date()).delete();

export const setSessionCookie = (res, token, { sameSite = 'strict' } = {}) => {
  res.cookie('auth_token', token, {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE,
    sameSite,
    secure: process.env.NODE_ENV === 'production'
  });
};
