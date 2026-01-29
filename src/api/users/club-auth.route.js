import express from 'express';
import bcrypt from 'bcrypt';
import crypto from 'crypto';
import pg from '../../utils/db.js';
import { checkMemberStatus, checkLeaderStatus, getOrCreateClubByName, linkUserToClub } from '../../utils/clubs.js';
import { validateEmail, validateUsername, validatePassword, normalizeEmail } from '../../utils/validation.js';

const router = express.Router();

const SALT_ROUNDS = 12;

const randomToken = () => crypto.randomBytes(32).toString('hex');

router.post('/club-member/signup', async (req, res) => {
  try {
    const { email: rawEmail, username: rawUsername, password } = req.body;

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

    const { isMember, clubName: memberClubName } = await checkMemberStatus(email);
    const { isLeader, clubName: leaderClubName } = await checkLeaderStatus(email);

    if (!isMember && !isLeader) {
      return res.status(403).json({
        success: false,
        message: 'No club membership found for this email. You must be a registered club member or leader to sign up with this method.'
      });
    }

    const clubName = leaderClubName || memberClubName;
    const role = isLeader ? 'leader' : 'member';

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
    const authToken = randomToken();

    const [newUser] = await pg('users')
      .insert({
        email,
        username,
        password_hash: passwordHash,
        authorization: authToken,
        max_spaces: 3,
        is_admin: false
      })
      .returning(['id', 'email', 'username', 'authorization', 'is_admin', 'hackatime_api_key', 'hackclub_id', 'hackclub_verification_status']);

    if (clubName) {
      try {
        const club = await getOrCreateClubByName(clubName);
        if (club) {
          await linkUserToClub(newUser.id, club.id, role, role === 'leader' ? 'leader_email' : 'member_lookup');
        }
      } catch (clubError) {
        console.error('Error linking user to club:', clubError);
      }
    }

    res.cookie('auth_token', newUser.authorization, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });

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

router.post('/club-member/login', async (req, res) => {
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

    const newAuthToken = randomToken();

    const [updatedUser] = await pg('users')
      .where('email', email)
      .update({ authorization: newAuthToken })
      .returning(['email', 'username', 'authorization', 'is_admin', 'hackatime_api_key', 'hackclub_id', 'hackclub_verification_status']);

    res.cookie('auth_token', updatedUser.authorization, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production'
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        email: updatedUser.email,
        username: updatedUser.username,
        is_admin: updatedUser.is_admin,
        hackatime_api_key: updatedUser.hackatime_api_key,
        hackclub_id: updatedUser.hackclub_id,
        hackclub_verification_status: updatedUser.hackclub_verification_status
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

    const { isMember, clubName: memberClubName } = await checkMemberStatus(email);
    const { isLeader, clubName: leaderClubName } = await checkLeaderStatus(email);

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
        clubName: leaderClubName || memberClubName,
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
