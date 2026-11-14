import express from 'express';
import { sendEmail, verifyCode, consumeCode } from '../../utils/airtable.js';
import pg from '../../utils/db.js';
import { sendCodeIpLimiter, sendCodeGlobalLimiter, authLimiter, accountIpLimiter } from '../../middlewares/rate-limit.middleware.js';
import { validateEmail, validateUsername, normalizeEmail } from '../../utils/validation.js';
import { extractAuth } from '../../middlewares/auth.middleware.js';
import { getUser } from '../../utils/user.js';
import { resolveAccess, isStaffPermissionList } from '../../utils/permissions.js';
import { createSession, deleteSession, setSessionCookie } from '../../utils/sessions.js';

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

    return res.status(200).json({
      success: true,
      data: {
        username: user.username,
        email: user.email,
        is_admin: isStaffPermissionList(permissions) || Boolean(access.viewingAs),
        is_superadmin: Boolean(access.user.is_superadmin),
        permissions,
        viewing_as: access.viewingAs,
        hackatime_api_key: user.hackatime_api_key,
        hackclub_id: user.hackclub_id,
        hackclub_verification_status: user.hackclub_verification_status,
        vscode_extensions: user.vscode_extensions
      }
    })
  } catch (_) {
    return res.status(401).json({
      success: false
    })
  }
})

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

    setSessionCookie(res, await createSession(newUser.id, 'email'));

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

    setSessionCookie(res, await createSession(user.id, 'email'));

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

    if (hackatime_api_key !== undefined) {
      updates.hackatime_api_key = hackatime_api_key;
    }

    if (vscode_extensions !== undefined) {
      updates.vscode_extensions = vscode_extensions;
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