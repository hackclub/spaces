import pg from './db.js';
import { createTokenCrypto } from './token-crypto.js';

export const GITHUB_SCOPES = 'repo read:org workflow';
const GITHUB_URL = process.env.GITHUB_URL || 'https://github.com';
const API_URL = process.env.GITHUB_API_URL || 'https://api.github.com';
export const AUTHORIZE_URL = new URL('/login/oauth/authorize', GITHUB_URL).toString();
export const TOKEN_URL = new URL('/login/oauth/access_token', GITHUB_URL).toString();

const githubTokens = createTokenCrypto('GITHUB_TOKEN_KEY');

export const githubOAuthConfigured = () => Boolean(
  process.env.GITHUB_CLIENT_ID
  && process.env.GITHUB_CLIENT_SECRET
  && process.env.GITHUB_REDIRECT_URI
  && githubTokens.configured()
);

export const encryptGithubToken = githubTokens.encrypt;
export const decryptGithubToken = githubTokens.decrypt;

const githubApi = async (path, accessToken, timeoutMs = 10000) => {
  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Hack-Club-Spaces'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) {
    const error = new Error(`GitHub answered ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
};

export const fetchGithubAccount = async (accessToken, timeoutMs) => {
  const profile = await githubApi('/user', accessToken, timeoutMs);
  if (!profile?.login || profile.id == null) throw new Error('GitHub returned no account');
  return { login: profile.login, id: String(profile.id), name: profile.name || '' };
};

export const fetchGithubRepos = async (accessToken) => {
  const repos = await githubApi('/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member', accessToken);
  return Array.isArray(repos)
    ? repos.map((repo) => ({ name: repo.full_name, private: Boolean(repo.private), description: repo.description || '' }))
    : [];
};

export const revokeGithubGrant = async (accessToken) => {
  if (!accessToken) return;
  try {
    const basic = Buffer.from(`${process.env.GITHUB_CLIENT_ID}:${process.env.GITHUB_CLIENT_SECRET}`).toString('base64');
    await fetch(`${API_URL}/applications/${encodeURIComponent(process.env.GITHUB_CLIENT_ID)}/grant`, {
      method: 'DELETE',
      headers: {
        Authorization: `Basic ${basic}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Hack-Club-Spaces',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ access_token: accessToken }),
      signal: AbortSignal.timeout(10000)
    });
  } catch (err) {
    console.error('Failed to revoke GitHub access:', err.message);
  }
};

export const clearGithubLink = (userId) => pg('users').where({ id: userId }).update({
  github_token: null,
  github_user_id: null,
  github_username: null,
  github_linked_at: null
});

export const currentGithubLogin = async (user) => {
  const accessToken = decryptGithubToken(user?.github_token);
  if (!accessToken) return null;

  try {
    const account = await fetchGithubAccount(accessToken, 5000);
    if (account.login !== user.github_username) {
      await pg('users').where({ id: user.id }).update({ github_username: account.login });
    }
    return { token: accessToken, ...account };
  } catch (err) {
    if (err.status === 401) {
      await clearGithubLink(user.id);
      return null;
    }
    console.error(`Failed to check the GitHub connection of user ${user.id}:`, err.message);
    if (!user.github_username || !user.github_user_id) return null;
    return { token: accessToken, login: user.github_username, id: user.github_user_id, name: '' };
  }
};
