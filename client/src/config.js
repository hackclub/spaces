// API Configuration
export const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5678/api/v1';

// Error Messages
export const ERROR_MESSAGES = {
  NETWORK_ERROR: 'Network error. Please try again.',
  AUTH_FAILED: 'Authentication failed',
  INVALID_EMAIL: 'Invalid email format',
  INVALID_CODE: 'Invalid or expired verification code',
  CREATE_FAILED: 'Failed to create space',
  START_FAILED: 'Failed to start space',
  STOP_FAILED: 'Failed to stop space',
  STATUS_FAILED: 'Failed to get status',
};
