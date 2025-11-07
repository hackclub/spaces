import express from 'express';
import { sendEmail, checkEmail } from '../../utils/airtable.js';
import pg from '../../utils/db.js';
import crypto from 'crypto';
import { strictLimiter, authLimiter } from '../../middlewares/rate-limit.middleware.js';

const router = express.Router();

const randomToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

router.get('/send', (req, res) => {
  res.status(200).json({
    message: 'Use Post to /send to send verification code',
  });
});

// POST /api/v1/users/send 
router.post('/send', strictLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email is required'
      });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
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
    res.status(500).json({
      success: false,
      message: 'Failed to send verification code',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/v1/users/signup 
router.post('/signup', authLimiter, async (req, res) => {
  try {
    const { email, username, verificationCode } = req.body;
    
    if (!email || !username || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Email, username, and verification code are required'
      });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
    if (username.length > 100) {
      return res.status(400).json({
        success: false,
        message: 'Username must be 100 characters or less'
      });
    }
    
    const codeValid = await checkEmail(email, verificationCode);
    if (!codeValid) {
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
    
    const authToken = randomToken();
    
    const [newUser] = await pg('users')
      .insert({
        email,
        username,
        authorization: authToken,
        max_spaces: 3,
        is_admin: false
      })
      .returning(['id', 'email', 'username', 'authorization', 'is_admin']);
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        id: newUser.id,
        email: newUser.email,
        username: newUser.username,
        authorization: newUser.authorization,
        is_admin: newUser.is_admin
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
router.post('/login', authLimiter, async (req, res) => {
  try {
    const { email, verificationCode } = req.body;
    
    if (!email || !verificationCode) {
      return res.status(400).json({
        success: false,
        message: 'Email and verification code are required'
      });
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid email format'
      });
    }
    
    const codeValid = await checkEmail(email, verificationCode);
    if (!codeValid) {
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
        message: 'User not found. Please sign up first.'
      });
    }
    
    const newAuthToken = randomToken();
    
    const [updatedUser] = await pg('users')
      .where('email', email)
      .update({ authorization: newAuthToken })
      .returning(['email', 'username', 'authorization', 'is_admin']);
    
    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        email: updatedUser.email,
        username: updatedUser.username,
        authorization: updatedUser.authorization,
        is_admin: updatedUser.is_admin
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
    const { authorization } = req.body;
    
    if (!authorization) {
      return res.status(400).json({
        success: false,
        message: 'Authorization token is required'
      });
    }
    
    const user = await pg('users')
      .where('authorization', authorization)
      .first();
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }
    
    const newAuthToken = randomToken();
    
    const [updatedUser] = await pg('users')
      .where('authorization', authorization)
      .update({ authorization: newAuthToken })
      .returning(['email']);
    
    res.status(200).json({
      success: true,
      message: 'Sign out successful',
      data: {
        email: updatedUser.email,
      }
    });
    
  } catch (error) {
    console.error('Error in /signout route:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to sign out',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;