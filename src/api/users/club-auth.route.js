import express from 'express';
import bcrypt from 'bcrypt';
import pg from '../../utils/db.js';
import { checkMemberStatus, checkLeaderStatus, getOrCreateClubByName, linkUserToClub } from '../../utils/clubs.js';
import { checkEmail } from '../../utils/airtable.js';
import { authLimiter } from '../../middlewares/rate-limit.middleware.js';
import { validateEmail, validateUsername, validatePassword, normalizeEmail } from '../../utils/validation.js';
import { createSession, setSessionCookie } from '../../utils/sessions.js';

const router = express.Router();

const SALT_ROUNDS = 12;

router.post('/club-member/signup', authLimiter, async (req, res) => {
  try {
    const { email: rawEmail, username: rawUsername, password, verificationCode } = req.body;

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

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return res.status(400).json({
        success: false,
        message: passwordValidation.message
      });
    }

    if (!verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Verification code is required'
      });
    }

    const codeValid = await checkEmail(email, Number.parseInt(verificationCode, 10));
    if (!codeValid) {
      return res.status(400).json({
        success: false,
        message: 'Invalid or expired verification code'
      });
    }

    const { isMember, clubName } = await checkMemberStatus(email);
    const { isLeader } = await checkLeaderStatus(email);

    if (isLeader) {
      return res.status(403).json({
        success: false,
        message: 'Club leaders sign in with their Hack Club account. Go back and choose Continue with Hack Club.'
      });
    }

    if (!isMember) {
      return res.status(403).json({
        success: false,
        message: 'No club membership found for this email. You must be a registered club member to sign up with this method.'
      });
    }

    const role = 'member';

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

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [newUser] = await pg('users')
      .insert({
        email,
        username,
        password_hash: passwordHash,
        max_spaces: 3,
        is_admin: false
      })
      .returning(['id', 'email', 'username', 'is_admin', 'hackatime_api_key', 'hackclub_id', 'hackclub_verification_status']);

    if (clubName) {
      try {
        const club = await getOrCreateClubByName(clubName);
        if (club) {
          await linkUserToClub(newUser.id, club.id, role, 'member_lookup');
        }
      } catch (clubError) {
        console.error('Error linking user to club:', clubError);
      }
    }

    setSessionCookie(res, await createSession(newUser.id));

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      data: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        is_admin: newUser.is_admin,
        hackatime_api_key: newUser.hackatime_api_key,
        hackclub_id: newUser.hackclub_id,
        hackclub_verification_status: newUser.hackclub_verification_status,
        club_name: clubName,
        club_role: role
      }
    });

  } catch (error) {
    console.error('Error in /club-member/signup route:', error);

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

router.post('/club-member/login', authLimiter, async (req, res) => {
  try {
    const { email: rawEmail, password } = req.body;

    const emailValidation = validateEmail(rawEmail);
    if (!emailValidation.valid) {
      return res.status(400).json({
        success: false,
        message: emailValidation.message
      });
    }
    const email = emailValidation.normalized;

    if (!password) {
      return res.status(400).json({
        success: false,
        message: 'Password is required'
      });
    }

    const user = await pg('users')
      .where('email', email)
      .first();

    const genericAuthError = {
      success: false,
      message: 'Invalid email or password'
    };

    if (!user) {
      await bcrypt.hash('dummy-password', SALT_ROUNDS);
      return res.status(401).json(genericAuthError);
    }

    if (!user.password_hash) {
      return res.status(401).json(genericAuthError);
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);
    if (!passwordValid) {
      return res.status(401).json(genericAuthError);
    }

    setSessionCookie(res, await createSession(user.id));

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
    console.error('Error in /club-member/login route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to login',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

router.post('/club-member/check', async (req, res) => {
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

    const { isMember } = await checkMemberStatus(email);
    const { isLeader } = await checkLeaderStatus(email);

    if (!isMember && !isLeader) {
      return res.status(404).json({
        success: false,
        message: 'No club membership found for this email'
      });
    }

    const existingUser = await pg('users').where('email', email).first();

    res.status(200).json({
      success: true,
      data: {
        isMember: isMember || isLeader,
        isLeader,
        hasExistingAccount: !!existingUser,
        hasPasswordAuth: existingUser?.password_hash ? true : false
      }
    });

  } catch (error) {
    console.error('Error in /club-member/check route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check membership status',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;
