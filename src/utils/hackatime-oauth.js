import pg from './db.js';
import { createTokenCrypto } from './token-crypto.js';

const HACKATIME_URL = process.env.HACKATIME_URL || 'https://hackatime.hackclub.com';

export const HACKATIME_SCOPES = 'profile read';
export const AUTHORIZE_URL = new URL('/oauth/authorize', HACKATIME_URL).toString();
export const TOKEN_URL = new URL('/oauth/token', HACKATIME_URL).toString();
const REVOKE_URL = new URL('/oauth/revoke', HACKATIME_URL).toString();
const ME_URL = new URL('/api/v1/authenticated/me', HACKATIME_URL).toString();
const API_KEYS_URL = new URL('/api/v1/authenticated/api_keys', HACKATIME_URL).toString();

const hackatimeTokens = createTokenCrypto('HACKATIME_TOKEN_KEY');

export const hackatimeOAuthConfigured = () => Boolean(
  process.env.HACKATIME_CLIENT_ID
  && process.env.HACKATIME_CLIENT_SECRET
  && process.env.HACKATIME_REDIRECT_URI
  && hackatimeTokens.configured()
);

export const encryptToken = hackatimeTokens.encrypt;
export const decryptToken = hackatimeTokens.decrypt;

const authorizedGet = async (url, accessToken, timeoutMs) => {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const error = new Error(`Hackatime answered ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

export const isHackatimeKey = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]+$/.test(value);

export const fetchHackatimeProfile = (accessToken, timeoutMs = 15000) => authorizedGet(ME_URL, accessToken, timeoutMs);

export const fetchHackatimeKey = async (accessToken, timeoutMs = 15000) => {
  const token = (await authorizedGet(API_KEYS_URL, accessToken, timeoutMs))?.token;
  if (!isHackatimeKey(token)) throw new Error('Hackatime returned no usable API key');
  return token;
};

export const revokeHackatimeToken = async (accessToken) => {
  if (!accessToken) return;
  try {
    await fetch(REVOKE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        token: accessToken,
        client_id: process.env.HACKATIME_CLIENT_ID,
        client_secret: process.env.HACKATIME_CLIENT_SECRET
      }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    console.error('Failed to revoke Hackatime token:', err.message);
  }
};

export const currentHackatimeKey = async (user) => {
  const accessToken = decryptToken(user?.hackatime_token);
  if (!accessToken) return user?.hackatime_api_key ?? null;

  try {
    const key = await fetchHackatimeKey(accessToken, 5000);
    if (key !== user.hackatime_api_key) {
      await pg('users').where({ id: user.id }).update({ hackatime_api_key: key });
    }
    return key;
  } catch (err) {
    if (err.status === 401) {
      await pg('users').where({ id: user.id }).update({ hackatime_token: null, hackatime_linked_at: null });
    } else {
      console.error(`Failed to refresh the Hackatime key of user ${user.id}:`, err.message);
    }
    return user.hackatime_api_key ?? null;
  }
};
