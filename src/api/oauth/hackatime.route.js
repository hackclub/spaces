import express from 'express';
import crypto from 'crypto';
import pg from '../../utils/db.js';
import { getUser } from '../../utils/user.js';
import { extractAuth } from '../../middlewares/auth.middleware.js';
import {
  HACKATIME_SCOPES,
  AUTHORIZE_URL,
  TOKEN_URL,
  hackatimeOAuthConfigured,
  encryptToken,
  decryptToken,
  fetchHackatimeProfile,
  fetchHackatimeKey,
  revokeHackatimeToken
} from '../../utils/hackatime-oauth.js';

const router = express.Router();
router.use(extractAuth);

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE = 'hackatime_oauth_state';
const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: true,
  path: '/api/v1/oauth/hackatime',
  maxAge: STATE_TTL_MS
};

const finish = (res, params) => res.redirect(`/settings#${new URLSearchParams(params)}`);

const stateMatchesCookie = (req, state) => {
  const cookie = req.cookies?.[STATE_COOKIE];
  if (typeof cookie !== 'string' || typeof state !== 'string') return false;
  const a = Buffer.from(cookie);
  const b = Buffer.from(state);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

const currentUser = async (req, res) => {
  const user = req.authToken ? await getUser(req.authToken) : null;
  if (!user) res.status(401).json({ success: false, message: 'Unauthorized' });
  return user;
};

router.post('/link', async (req, res) => {
  try {
    if (!hackatimeOAuthConfigured()) {
      return res.status(503).json({ success: false, message: 'Connecting Hackatime is not set up on this server yet' });
    }
    const user = await currentUser(req, res);
    if (!user) return;

    await pg('oauth_states').where('created_at', '<', new Date(Date.now() - STATE_TTL_MS)).delete();

    const state = crypto.randomBytes(32).toString('hex');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    await pg('oauth_states').insert({
      state,
      mode: 'hackatime',
      user_id: user.id,
      code_verifier: codeVerifier,
      created_at: new Date()
    });

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', process.env.HACKATIME_CLIENT_ID);
    url.searchParams.set('redirect_uri', process.env.HACKATIME_REDIRECT_URI);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', HACKATIME_SCOPES);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');

    res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTIONS);
    res.json({ success: true, url: url.toString() });
  } catch (error) {
    console.error('Error starting Hackatime link:', error);
    res.status(500).json({ success: false, message: 'Failed to start connecting Hackatime' });
  }
});

router.get('/callback', async (req, res) => {
  try {
    if (!hackatimeOAuthConfigured()) return finish(res, { hackatime_error: 'failed' });

    const { code, state, error: oauthError } = req.query;

    if (oauthError) return finish(res, { hackatime_error: 'denied' });
    if (typeof code !== 'string' || !stateMatchesCookie(req, state)) {
      return finish(res, { hackatime_error: 'invalid_state' });
    }
    res.clearCookie(STATE_COOKIE, STATE_COOKIE_OPTIONS);

    const [stateRow] = await pg('oauth_states')
      .where({ state, mode: 'hackatime' })
      .delete()
      .returning(['user_id', 'code_verifier', 'created_at']);

    if (!stateRow || Date.now() - new Date(stateRow.created_at).getTime() > STATE_TTL_MS) {
      return finish(res, { hackatime_error: 'state_expired' });
    }

    const sessionUser = req.authToken ? await getUser(req.authToken) : null;
    if (sessionUser && sessionUser.id !== stateRow.user_id) {
      return finish(res, { hackatime_error: 'user_mismatch' });
    }

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: process.env.HACKATIME_REDIRECT_URI,
        client_id: process.env.HACKATIME_CLIENT_ID,
        client_secret: process.env.HACKATIME_CLIENT_SECRET,
        code_verifier: stateRow.code_verifier
      }),
      signal: AbortSignal.timeout(15000)
    });

    if (!tokenResponse.ok) {
      console.error('Hackatime token exchange failed:', tokenResponse.status);
      return finish(res, { hackatime_error: 'token_failed' });
    }

    const { access_token: accessToken } = await tokenResponse.json();
    if (!accessToken) return finish(res, { hackatime_error: 'token_failed' });

    let apiKey;
    let profile;
    try {
      [apiKey, profile] = await Promise.all([fetchHackatimeKey(accessToken), fetchHackatimeProfile(accessToken)]);
    } catch (err) {
      console.error('Reading the new Hackatime connection failed:', err.message);
      await revokeHackatimeToken(accessToken);
      return finish(res, { hackatime_error: 'key_failed' });
    }

    const previous = await pg('users').where({ id: stateRow.user_id }).first('hackatime_token');
    await pg('users').where({ id: stateRow.user_id }).update({
      hackatime_api_key: apiKey,
      hackatime_user_id: profile?.id != null ? String(profile.id) : null,
      hackatime_token: encryptToken(accessToken),
      hackatime_linked_at: new Date()
    });
    await revokeHackatimeToken(decryptToken(previous?.hackatime_token));

    finish(res, { hackatime: 'linked' });
  } catch (error) {
    console.error('Hackatime callback error:', error);
    finish(res, { hackatime_error: 'failed' });
  }
});

router.post('/unlink', async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    if (!user.hackatime_linked_at) {
      return res.status(400).json({ success: false, message: 'Hackatime is not connected' });
    }

    await pg('users').where({ id: user.id }).update({
      hackatime_api_key: null,
      hackatime_user_id: null,
      hackatime_token: null,
      hackatime_linked_at: null
    });
    await revokeHackatimeToken(decryptToken(user.hackatime_token));

    res.json({ success: true, message: 'Hackatime disconnected' });
  } catch (error) {
    console.error('Error unlinking Hackatime:', error);
    res.status(500).json({ success: false, message: 'Failed to disconnect Hackatime' });
  }
});

export default router;
