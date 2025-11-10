import express from 'express';
import { updateUser } from '../../utils/user.js';

const router = express.Router();

router.post('/', async (req, res) => {
  try {
    const { authorization, email, username, hackatime_api_key } = req.body;
    
    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: 'Authorization token is required'
      });
    }

    const updateData = {};
    if (email !== undefined) updateData.email = email;
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