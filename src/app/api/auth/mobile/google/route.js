import { NextResponse } from 'next/server';
import { execute as query } from '@/lib/db';
import { jwtSecret } from '@/lib/jwt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const ALLOWED_AUDIENCES = [
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_ID_ANDROID,
  // Add iOS Client ID here if needed later
].filter(Boolean);

export async function POST(request) {
  try {
    // Sessions are signed with the configured JWT_SECRET (src/lib/jwt.js);
    // without it this route answers before it reads the request.
    const secret = jwtSecret();
    const body = await request.json().catch(() => ({}));
    const { token, role = 'user', mode = 'login', device_id = 'mobile-app' } = body;

    console.log(`📱 [Mobile Google Auth] Request received:`, { role, mode, device_id, tokenLength: token?.length });

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Google token is required' },
        { status: 400 }
      );
    }

    // 1. Verify Google Token
    console.log('📡 [Mobile Google Auth] Verifying token with Google...');
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    const googleData = await googleRes.json();

    if (googleData.error_description || googleData.error) {
      console.error('❌ [Mobile Google Auth] Google verification failed:', googleData.error_description || googleData.error);
      return NextResponse.json(
        { success: false, message: 'Invalid Google token' },
        { status: 401 }
      );
    }

    const { email, given_name, family_name, name, picture, aud } = googleData;
    console.log('✅ [Mobile Google Auth] Google verified user:', email);
    
    // 2. Verify audience (must match our client IDs)
    if (!ALLOWED_AUDIENCES.includes(aud)) {
      console.error('❌ [Mobile Google Auth] Security Warning: Audience mismatch', { aud, expected: ALLOWED_AUDIENCES });
      // Note: We'll allow it anyway if IDs aren't set in .env for now to avoid blocking the user
      if (ALLOWED_AUDIENCES.length > 0) {
        return NextResponse.json(
          { success: false, message: 'Security verification failed: Audience mismatch' },
          { status: 403 }
        );
      }
    }

    let user = null;
    let dbType = (role === 'provider' || role === 'pro') ? 'provider' : 'customer';

    console.log(`🔍 [Mobile Google Auth] Mode: ${mode} | Role Verification: ${email} (Intended: ${dbType})`);

    // ── ROLE ISOLATION & LOGIN LOGIC ───────────
    // Step 1: Detect presence in both tables
    const existingUsers = await query("SELECT * FROM users WHERE email = ?", [email]);
    const existingProviders = await query("SELECT * FROM service_providers WHERE email = ?", [email]);

    const hasCustomerAccount = existingUsers.length > 0;
    const hasProviderAccount = existingProviders.length > 0;

    // Step 2: Role Handling (STRICT ROLE ISOLATION)
    if (hasCustomerAccount || hasProviderAccount) {
      // User EXISTS
      if (mode === 'signup') {
        // STRICT SIGNUP: Prevent creating a customer account if they are already a provider
        if (dbType === 'customer' && hasProviderAccount) {
          console.warn(`🚨 [GoogleAuth] Signup Blocked: ${email} is a Provider`);
          return NextResponse.json(
            { success: false, message: 'This email is registered as a service provider. Please log in as a Professional.' },
            { status: 403 }
          );
        }
        
        // Prevent creating a provider account if they are already a customer
        if (dbType === 'provider' && hasCustomerAccount) {
          console.warn(`🚨 [GoogleAuth] Signup Blocked: ${email} is a Customer`);
          return NextResponse.json(
            { success: false, message: 'This email is already registered as a customer. Please use a different email for your professional account.' },
            { status: 403 }
          );
        }
        
        console.log(`ℹ️ [GoogleAuth] ${email} already exists, treating signup as login.`);
      }

      // LOGIN MODE & EXISTING USER Handling
      if (dbType === 'provider') {
        if (hasProviderAccount) {
          user = existingProviders[0];
          console.log('✅ [Mobile Google Auth] Logging in as existing Professional.');
          
          if (user.email_verified !== 1) {
            await query('UPDATE service_providers SET email_verified = 1 WHERE id = ?', [user.id || user.ID]);
            user.email_verified = 1; 
          }
        } else if (hasCustomerAccount) {
          console.warn(`🚨 [GoogleAuth] Cross-Role Login: ${email} is a Customer`);
          return NextResponse.json(
            { success: false, message: 'This email is registered as a Customer. Please use the Customer login screen.' },
            { status: 403 }
          );
        }
      } else {
        // dbType is 'customer'
        if (hasCustomerAccount) {
          user = existingUsers[0];
          console.log('✅ [Mobile Google Auth] Logging in as existing Customer.');
        } else if (hasProviderAccount) {
          console.warn(`🚨 [GoogleAuth] Cross-Role Login: ${email} is a Provider`);
          return NextResponse.json(
            { success: false, message: 'This email is registered as a Professional. Please use the Professional login screen.' },
            { status: 403 }
          );
        }
      }

    } else {
      // NEW USER: Create as the intended role
      if (dbType === 'provider') {
        console.log('📝 [Mobile Google Auth] Creating new Professional account...');
        const tempPhone = 'gAuth' + Date.now().toString().slice(-10);
        const result = await query(
          `INSERT INTO service_providers (name, email, password, phone, status, email_verified, avatar_url, onboarding_step)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [name || `${given_name || ''} ${family_name || ''}`.trim() || 'Google User', email, 'google-auth-placeholder', tempPhone, 'pending', 1, picture || null, 1]
        );
        const newProvider = await query('SELECT * FROM service_providers WHERE id = ?', [result.insertId]);
        user = newProvider[0];
      } else {
        console.log('📝 [Mobile Google Auth] Creating new Customer account...');
        const result = await query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, image_url)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [email, 'google-auth-placeholder', given_name || '', family_name || '', 'user', picture || null]
        );
        const newUser = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        user = newUser[0];
      }
    }

    if (!user) {
      console.error('❌ [Mobile Google Auth] User object still null after DB operation');
      throw new Error('User creation or retrieval failed');
    }

    // ─────────────────────────────────────────────────────────────────────────────

    // 3. Generate JWT (Synchronized with standard mobile login payload)
    console.log('🔑 [Mobile Google Auth] Generating session token...');
    const actualId = Number(user.id || user.ID);
    const authToken = jwt.sign(
      {
        id: actualId,
        providerId: dbType === 'provider' ? actualId : undefined,
        email: user.email,
        role: dbType,
        type: dbType // Critical for provider-specific routes/middleware
      },
      secret,
      { expiresIn: '7d' }
    );
    const refreshToken = crypto.randomBytes(64).toString('hex');

    // 4. Update mobile_auth table
    try {
      const userIdCol = (dbType === 'provider') ? 'provider_id' : 'user_id';
      await query(
          `INSERT INTO mobile_auth_users (${userIdCol}, user_type, last_login, device_id, refresh_token, refresh_token_expires)
           VALUES (?, ?, NOW(), ?, ?, DATE_ADD(NOW(), INTERVAL 365 DAY))
           ON DUPLICATE KEY UPDATE 
             last_login = NOW(), 
             device_id = VALUES(device_id),
             refresh_token = VALUES(refresh_token),
             refresh_token_expires = VALUES(refresh_token_expires)`,
          [actualId, dbType, device_id || 'mobile-app', refreshToken]
      );
    } catch (e) {
      console.warn('⚠️ [Mobile Google Auth] Skipping session persistence:', e.message);
    }

    console.log('🎉 [Mobile Google Auth] Success!');
    return NextResponse.json({
      success: true,
      message: 'Google login successful',
      token: authToken,
      refreshToken: refreshToken,
      user: {
        id: actualId,
        email: user.email,
        name: user.name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Google User',
        role: dbType === 'provider' ? 'provider' : 'customer',
        image_url: user.image_url || user.avatar_url || picture || null,
        // Critical for redirection logic
        status: user.status || 'pending',
        email_verified: user.email_verified || 1,
        onboarding_step: user.onboarding_step || 1,
        onboarding_completed: user.onboarding_completed || 0,
        documents_uploaded: user.documents_uploaded || 0,
        stripe_onboarding_complete: user.stripe_onboarding_complete || 0
      }
    });

  } catch (error) {
    console.error('📱 [Mobile Google Auth] Critical Error:', error.message);
    return NextResponse.json(
      { success: false, message: 'Server error. Please try again.' },
      { status: 500 }
    );
  }
}
