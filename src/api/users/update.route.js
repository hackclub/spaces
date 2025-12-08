import express from 'express';
import { updateUser } from '../../utils/user.js';
import { checkEmail } from '../../utils/airtable.js';
import pg from '../../utils/db.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { authorization, email, oldEmailVerificationCode, emailVerificationCode, username, hackatime_api_key } = req.body;
    
    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required'
      });
    }
    
    const user = await pg('users').where('authorization', authorization).first();
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid authorization token'
      });
    }

    const updateData = {};
    
    if (email !== undefined) {
      if (!oldEmailVerificationCode) {
        return res.status(400).json({
          success: false,
          message: 'Verification code for current email is required'
        });
      }
      
      if (!emailVerificationCode) {
        return res.status(400).json({
          success: false,
          message: 'Verification code for new email is required'
        });
      }
      
      const oldCodeValid = await checkEmail(user.email, oldEmailVerificationCode);
      if (!oldCodeValid) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired verification code for current email'
        });
      }
      
      const newCodeValid = await checkEmail(email, emailVerificationCode);
      if (!newCodeValid) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or expired verification code for new email'
        });
      }
      
      updateData.email = email;
    }
    
    if (username !== undefined) updateData.username = username;
    if (hackatime_api_key !== undefined) updateData.hackatime_api_key = hackatime_api_key;

    const updatedUser = await updateUser(authorization, updateData);
    
    res.status(200).json({
      success: true,
      message: 'User updated successfully'
    });
    
  } catch (error) {
    console.error('Error in /update route:', error);
    
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to update user',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

export default router;