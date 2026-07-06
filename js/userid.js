export const DEFAULT_USER_ID = 'user_self';

export function isValidUserId(id) {
  if (typeof id !== 'string') return false;
  return /^[a-z0-9][a-z0-9_]*$/.test(id);
}

export function normalizeUserId(id) {
  if (typeof id !== 'string') return '';
  return id.trim().toLowerCase();
}
