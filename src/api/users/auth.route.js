import express from 'express';
import { sendEmail, verifyCode, consumeCode } from '../../utils/airtable.js';
import pg from '../../utils/db.js';
import { sendCodeIpLimiter, sendCodeGlobalLimiter, authLimiter, accountIpLimiter } from '../../middlewares/rate-limit.middleware.js';
import { validateEmail, validateUsername, normalizeEmail, validateExtensionList } from '../../utils/validation.js';
import { extractAuth } from '../../middlewares/auth.middleware.js';
import { getUser } from '../../utils/user.js';
import { resolveAccess, isStaffPermissionList, grantableRoles } from '../../utils/permissions.js';
import { createSession, deleteSession, setSessionCookie, hashToken, listUserSessions, deleteUserSession, deleteOtherSessions } from '../../utils/sessions.js';
import { describeUserAgent } from '../../utils/user-agent.js';
import { githubOAuthConfigured } from '../../utils/github-oauth.js';
import { hackatimeOAuthConfigured, revokeHackatimeToken, decryptToken } from '../../utils/hackatime-oauth.js';

const router = express.Router();
router.use(extractAuth);

router.get("/me", async (req, res) => {
  try {
    const authorization = req.authToken;
    if (!authorization) {
      return res.status(401).json({ success: false });
    }

    const user = await getUser(authorization);

    if (!user) {
      return res.status(401).json({ success: false });
    }

    const access = await resolveAccess(user, req);
    const permissions = [...access.permissions];
    const hackatimeAvailable = hackatimeOAuthConfigured();
    const hackatimeLinked = Boolean(user.hackatime_linked_at);

    return res.status(200).json({
      success: true,
      data: {
        username: user.username,
        email: user.email,
        is_admin: isStaffPermissionList(permissions) || access.grants.length > 0 || Boolean(access.viewingAs),
        is_superadmin: Boolean(access.user.is_superadmin),
        permissions,
        grantable_roles: await grantableRoles(access.grants),
        viewing_as: access.viewingAs,
        hackatime_api_key: user.hackatime_api_key,
        hackatime_available: hackatimeAvailable,
        hackatime_linked: hackatimeLinked,
        hackatime_prompt: hackatimeAvailable && !hackatimeLinked && !user.hackatime_api_key && !user.hackatime_prompt_answered_at,
        hackatime_needs_switch: hackatimeAvailable && !hackatimeLinked && Boolean(user.hackatime_api_key),
        hackclub_id: user.hackclub_id,
        hackclub_verification_status: user.hackclub_verification_status,
        vscode_extensions: user.vscode_extensions,
        github_username: user.github_linked_at ? user.github_username : null,
        github_available: githubOAuthConfigured(),
        github_linked: Boolean(user.github_linked_at)
      }
    })
  } catch (_) {
    return res.status(401).json({
      success: false
    })
  }
})

const signedInUser = async (req, res) => {
  const user = req.authToken ? await getUser(req.authToken) : null;
  if (!user) {
    res.status(401).json({ success: false, message: 'Unauthorized' });
  }
  return user;
};

router.get('/limits', async (req, res) => {
  try {
    const user = await signedInUser(req, res);
    if (!user) return;

    const counts = await pg('spaces')
      .where('user_id', user.id)
      .first(pg.raw('count(*)::int as spaces'), pg.raw('count(*) filter (where running)::int as running'));

    res.json({
      success: true,
      data: {
        spaces: counts.spaces,
        max_spaces: user.max_spaces ?? 3,
        running: counts.running,
        max_running: user.max_running ?? 1
      }
    });
  } catch (error) {
    console.error('Error loading limits:', error);
    res.status(500).json({ success: false, message: 'Failed to load your limits' });
  }
});

router.get('/sessions', async (req, res) => {
  try {
    const user = await signedInUser(req, res);
    if (!user) return;

    const currentHash = hashToken(req.authToken);
    const sessions = await listUserSessions(user.id);

    res.json({
      success: true,
      data: sessions.map((session) => ({
        id: session.id,
        device: describeUserAgent(session.user_agent),
        method: session.method,
        created_at: session.created_at,
        expires_at: session.expires_at,
        current: session.token_hash === currentHash
      }))
    });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ success: false, message: 'Failed to load your sessions' });
  }
});

router.delete('/sessions/:id', async (req, res) => {
  try {
    const user = await signedInUser(req, res);
    if (!user) return;

    const sessionId = Number.parseInt(req.params.id, 10);
    if (!Number.isSafeInteger(sessionId)) {
      return res.status(400).json({ success: false, message: 'Invalid session' });
    }

    const current = await pg('sessions').where({ id: sessionId, user_id: user.id }).first('token_hash');
    if (!current) {
      return res.status(404).json({ success: false, message: 'That session has already ended' });
    }
    if (current.token_hash === hashToken(req.authToken)) {
      return res.status(400).json({ success: false, message: 'Use Sign out to end the session you are using' });
    }

    await deleteUserSession(user.id, sessionId);
    res.json({ success: true });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ success: false, message: 'Failed to sign that session out' });
  }
});

router.post('/sessions/sign-out-others', async (req, res) => {
  try {
    const user = await signedInUser(req, res);
    if (!user) return;

    const ended = await deleteOtherSessions(user.id, req.authToken);
    res.json({ success: true, data: { ended } });
  } catch (error) {
    console.error('Error ending other sessions:', error);
    res.status(500).json({ success: false, message: 'Failed to sign out your other sessions' });
  }
});

router.post('/hackatime-prompt', async (req, res) => {
  try {
    const user = req.authToken ? await getUser(req.authToken) : null;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    await pg('users')
      .where({ id: user.id })
      .whereNull('hackatime_prompt_answered_at')
      .update({ hackatime_prompt_answered_at: new Date() });

    res.json({ success: true });
  } catch (error) {
    console.error('Error saving Hackatime prompt answer:', error);
    res.status(500).json({ success: false, message: 'Failed to save your answer' });
  }
});


router.get('/send', (req, res) => {
  res.status(200).json({
    message: 'Use Post to /send to send verification code',
  });
});

// POST /api/v1/users/send
router.post('/send', sendCodeIpLimiter, sendCodeGlobalLimiter, async (req, res) => {
  try {
    const { email: rawEmail } = req.body;

    const emailValidation = validateEmail(rawEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({
        success: false,
        message: emailValidation.message
      });
    }
    const email = emailValidation.normalized;

    const result = await sendEmail(email);

    res.status(200).json({
      success: true,
      message: 'Verification code sent successfully',
      data: {
        email: result.email,
      }
    });

  } catch (error) {
    console.error('Error in /send route:', error);
    if (error.statusCode === 429) {
      return res.status(429).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/v1/users/signup 
router.post('/signup', accountIpLimiter, authLimiter, async (req, res) => {
  try {
    const { email: rawEmail, username: rawUsername, verificationCode } = req.body;

    const emailValidation = validateEmail(rawEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({
        success: false,
        message: emailValidation.message
      });
    }
    const email = emailValidation.normalized;

    const usernameValidation = validateUsername(rawUsername);
    if (!usernameValidation.valid) {
      return res.status(400).json({
        success: false,
        message: usernameValidation.message
      });
    }
    const username = usernameValidation.normalized;

    if (!verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }

    const codeId = await verifyCode(email, verificationCode);
    if (!codeId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    const existingUser = await pg('users')
      .where('email', email)
      .orWhere('username', username)
      .first();

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: existingUser.email === email ? 'Email already registered' : 'Username already taken'
      });
    }

    if (!(await consumeCode(codeId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    const [newUser] = await pg('users')
      .insert({
        email,
        username,
        max_spaces: 3,
        is_admin: false
      })
      .returning(['id', 'email', 'username', 'is_admin', 'hackatime_api_key', 'hackclub_id', 'hackclub_verification_status']);

    setSessionCookie(res, await createSession(newUser.id, 'email', req));

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        is_admin: newUser.is_admin,
        hackatime_api_key: newUser.hackatime_api_key,
        hackclub_id: newUser.hackclub_id,
        hackclub_verification_status: newUser.hackclub_verification_status
      }
    });

  } catch (error) {
    console.error('Error in /signup route:', error);

    if (error.code === '23505') {
      return res.status(409).json({
        success: false,
        message: 'Email or username already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Failed to create user account',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/v1/users/login
router.post('/login', accountIpLimiter, authLimiter, async (req, res) => {
  try {
    const { email: rawEmail, verificationCode } = req.body;

    const emailValidation = validateEmail(rawEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({
        success: false,
        message: emailValidation.message
      });
    }
    const email = emailValidation.normalized;

    if (!verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }

    const codeId = await verifyCode(email, verificationCode);
    if (!codeId) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    const user = await pg('users')
      .where('email', email)
      .first();

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account uses this email yet. Choose a username to create one.'
      });
    }

    if (!(await consumeCode(codeId))) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    setSessionCookie(res, await createSession(user.id, 'email', req));

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        email: user.email,
        username: user.username,
        is_admin: user.is_admin,
        hackatime_api_key: user.hackatime_api_key,
        hackclub_id: user.hackclub_id,
        hackclub_verification_status: user.hackclub_verification_status
      }
    });

  } catch (error) {
    console.error('Error in /login route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/v1/users/signout
router.post('/signout', async (req, res) => {
  try {
    const authorization = req.headers.authorization || req.cookies?.auth_token;

    if (!authorization) {
      res.clearCookie('auth_token');
      return res.status(200).json({
        success: true,
        message: 'Sign out successful'
      });
    }

    await deleteSession(authorization);

    res.clearCookie('auth_token');

    res.status(200).json({
      success: true,
      message: 'Sign out successful'
    });

  } catch (error) {
    console.error('Error in /signout route:', error);
    res.clearCookie('auth_token');
    res.status(200).json({
      success: true,
      message: 'Sign out successful'
    });
  }
});

// PUT /api/v1/users/update
router.put('/update', async (req, res) => {
  try {
    const authorization = req.authToken;
    const { username, hackatime_api_key, vscode_extensions } = req.body;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized'
      });
    }

    const user = await getUser(authorization);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const updates = {};

    if (username && username !== user.username) {
      const usernameValidation = validateUsername(username);
      if (!usernameValidation.valid) {
        return res.status(400).json({
          success: false,
          message: usernameValidation.message
        });
      }
      const newUsername = usernameValidation.normalized;

      const existingUser = await pg('users')
        .where('username', newUsername)
        .whereNot('id', user.id)
        .first();

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'Username already taken'
        });
      }
      updates.username = newUsername;
    }

    if (hackatime_api_key !== undefined && hackatime_api_key !== user.hackatime_api_key) {
      updates.hackatime_api_key = hackatime_api_key;
      updates.hackatime_user_id = null;
      updates.hackatime_linked_at = null;
      updates.hackatime_token = null;
      revokeHackatimeToken(decryptToken(user.hackatime_token));
    }

    if (vscode_extensions !== undefined) {
      const extensionsValidation = validateExtensionList(vscode_extensions);
      if (!extensionsValidation.valid) {
        return res.status(400).json({
          success: false,
          message: extensionsValidation.message
        });
      }
      updates.vscode_extensions = extensionsValidation.normalized;
    }

    if (Object.keys(updates).length > 0) {
      await pg('users')
        .where('id', user.id)
        .update(updates);
    }

    const updatedUser = await pg('users')
      .where('id', user.id)
      .first();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      data: {
        username: updatedUser.username,
        email: updatedUser.email,
        is_admin: updatedUser.is_admin,
        hackatime_api_key: updatedUser.hackatime_api_key,
        vscode_extensions: updatedUser.vscode_extensions
      }
    });

  } catch (error) {
    console.error('Error in /update route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update profile',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;