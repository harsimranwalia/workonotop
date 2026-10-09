import jwt from 'jsonwebtoken';

const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

// The key every session, e-mail verification and password reset token is signed and checked
// with: JWT_SECRET, read each time it is used. When it is unset or blank nothing is signed or accepted, and the error
// names the variable.
export function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error('JWT_SECRET is not configured: no session can be signed or checked');
  }
  return secret;
}

// ─── Generate Token (for login) ───────────────────────────────────────────────
export function generateToken(payload) {
  return jwt.sign(payload, jwtSecret(), { expiresIn: JWT_EXPIRES_IN });
}

// ─── Verify Token ─────────────────────────────────────────────────────────────
export function verifyToken(token) {
  try {
    return jwt.verify(token, jwtSecret());
  } catch (error) {
    console.error('JWT verify error:', error.message);
    return null;
  }
}

// ─── Decode Token (without verifying) ────────────────────────────────────────
export function decodeToken(token) {
  try {
    return jwt.decode(token);
  } catch (error) {
    return null;
  }
}

// ─── Generate Email Verification Token ───────────────────────────────────────
export function generateEmailVerificationToken(providerId, email) {
  return jwt.sign(
    { providerId, email, type: 'email_verification' },
    jwtSecret(),
    { expiresIn: '24h' }
  );
}

// ─── Verify Email Verification Token ─────────────────────────────────────────
export function verifyEmailVerificationToken(token) {
  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (decoded.type !== 'email_verification') return null;
    return decoded;
  } catch (error) {
    console.error('Email verification token error:', error.message);
    return null;
  }
}

// ─── Generate Password Reset Token ───────────────────────────────────────────
export function generatePasswordResetToken(providerId, email) {
  return jwt.sign(
    { providerId, email, type: 'password_reset' },
    jwtSecret(),
    { expiresIn: '1h' }
  );
}

// ─── Verify Password Reset Token ─────────────────────────────────────────────
export function verifyPasswordResetToken(token) {
  try {
    const decoded = jwt.verify(token, jwtSecret());
    if (decoded.type !== 'password_reset') return null;
    return decoded;
  } catch (error) {
    console.error('Password reset token error:', error.message);
    return null;
  }
}