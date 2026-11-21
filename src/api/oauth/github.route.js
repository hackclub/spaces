import express from 'express';
import crypto from 'crypto';
import pg from '../../utils/db.js';
import { getUser } from '../../utils/user.js';
import { extractAuth } from '../../middlewares/auth.middleware.js';
import {
  GITHUB_SCOPES,
  AUTHORIZE_URL,
  TOKEN_URL,
  githubOAuthConfigured,
  encryptGithubToken,
  decryptGithubToken,
  fetchGithubAccount,
  fetchGithubRepos,
  revokeGithubGrant,
  clearGithubLink
} from '../../utils/github-oauth.js';

const router = express.Router();
router.use(extractAuth);

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_COOKIE = 'github_oauth_state';
const STATE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: true,
  path: '/api/v1/oauth/github',
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
    if (!githubOAuthConfigured()) {
      return res.status(503).json({ success: false, message: 'Connecting GitHub is not set up on this server yet' });
    }
    const user = await currentUser(req, res);
    if (!user) return;

    await pg('oauth_states').where('created_at', '<', new Date(Date.now() - STATE_TTL_MS)).delete();

    const state = crypto.randomBytes(32).toString('hex');
    await pg('oauth_states').insert({ state, mode: 'github', user_id: user.id, created_at: new Date() });

    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set('client_id', process.env.GITHUB_CLIENT_ID);
    url.searchParams.set('redirect_uri', process.env.GITHUB_REDIRECT_URI);
    url.searchParams.set('scope', GITHUB_SCOPES);
    url.searchParams.set('state', state);

    res.cookie(STATE_COOKIE, state, STATE_COOKIE_OPTIONS);
    res.json({ success: true, url: url.toString() });
  } catch (error) {
    console.error('Error starting GitHub link:', error);
    res.status(500).json({ success: false, message: 'Failed to start connecting GitHub' });
  }
});

router.get('/callback', async (req, res) => {
  try {
    if (!githubOAuthConfigured()) return finish(res, { github_error: 'failed' });

    const { code, state, error: oauthError } = req.query;

    if (oauthError) return finish(res, { github_error: 'denied' });
    if (typeof code !== 'string' || !stateMatchesCookie(req, state)) {
      return finish(res, { github_error: 'invalid_state' });
    }
    res.clearCookie(STATE_COOKIE, STATE_COOKIE_OPTIONS);

    const [stateRow] = await pg('oauth_states')
      .where({ state, mode: 'github' })
      .delete()
      .returning(['user_id', 'created_at']);

    if (!stateRow || Date.now() - new Date(stateRow.created_at).getTime() > STATE_TTL_MS) {
      return finish(res, { github_error: 'state_expired' });
    }

    const sessionUser = req.authToken ? await getUser(req.authToken) : null;
    if (sessionUser && sessionUser.id !== stateRow.user_id) {
      return finish(res, { github_error: 'user_mismatch' });
    }

    const tokenResponse = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        client_id: process.env.GITHUB_CLIENT_ID,
        client_secret: process.env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: process.env.GITHUB_REDIRECT_URI
      }),
      signal: AbortSignal.timeout(15000)
    });

    const tokenData = tokenResponse.ok ? await tokenResponse.json() : null;
    const accessToken = tokenData?.access_token;
    if (!accessToken) {
      console.error('GitHub token exchange failed:', tokenResponse.status, tokenData?.error);
      return finish(res, { github_error: 'token_failed' });
    }

    let account;
    try {
      account = await fetchGithubAccount(accessToken);
    } catch (err) {
      console.error('Reading the new GitHub connection failed:', err.message);
      await revokeGithubGrant(accessToken);
      return finish(res, { github_error: 'account_failed' });
    }

    await pg('users').where({ id: stateRow.user_id }).update({
      github_token: encryptGithubToken(accessToken),
      github_user_id: account.id,
      github_username: account.login,
      github_linked_at: new Date()
    });

    finish(res, { github: 'linked' });
  } catch (error) {
    console.error('GitHub callback error:', error);
    finish(res, { github_error: 'failed' });
  }
});

router.post('/unlink', async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    if (!user.github_linked_at) {
      return res.status(400).json({ success: false, message: 'GitHub is not connected' });
    }

    await clearGithubLink(user.id);
    await revokeGithubGrant(decryptGithubToken(user.github_token));

    res.json({ success: true, message: 'GitHub disconnected' });
  } catch (error) {
    console.error('Error unlinking GitHub:', error);
    res.status(500).json({ success: false, message: 'Failed to disconnect GitHub' });
  }
});

router.get('/repos', async (req, res) => {
  try {
    const user = await currentUser(req, res);
    if (!user) return;

    const accessToken = decryptGithubToken(user.github_token);
    if (!accessToken) return res.json({ success: true, data: [] });

    try {
      res.json({ success: true, data: await fetchGithubRepos(accessToken) });
    } catch (err) {
      if (err.status === 401) await clearGithubLink(user.id);
      res.json({ success: true, data: [] });
    }
  } catch (error) {
    console.error('Error listing GitHub repos:', error);
    res.status(500).json({ success: false, message: 'Failed to list your GitHub repos' });
  }
});

export default router;
