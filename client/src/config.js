export const API_BASE = window.location.hostname === 'localhost' || window.location.hostname.includes('github.dev')
  ? `${window.location.protocol}//${window.location.host}/api/v1`
  : 'https://t0080w08wcockgs44ws8w880.b.selfhosted.hackclub.com/api/v1';

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
