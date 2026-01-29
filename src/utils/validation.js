export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const USERNAME_REGEX = /^[a-zA-Z0-9_-]{3,30}$/;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72;

export function normalizeEmail(email) {
  if (!email || typeof email !== 'string') return null;
  return email.trim().toLowerCase();
}

export function validateEmail(email) {
  if (!email) return { valid: false, message: 'Email is required' };
  const normalized = normalizeEmail(email);
  if (!EMAIL_REGEX.test(normalized)) {
    return { valid: false, message: 'Invalid email format' };
  }
  return { valid: true, normalized };
}

export function validateUsername(username) {
  if (!username) return { valid: false, message: 'Username is required' };
  const trimmed = username.trim();
  if (!USERNAME_REGEX.test(trimmed)) {
    return { 
      valid: false, 
      message: 'Username must be 3-30 characters and contain only letters, numbers, underscores, and hyphens' 
    };
  }
  return { valid: true, normalized: trimmed };
}

export function validatePassword(password) {
  if (!password) return { valid: false, message: 'Password is required' };
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { valid: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { valid: false, message: `Password must be ${PASSWORD_MAX_LENGTH} characters or less` };
  }
  return { valid: true };
}
