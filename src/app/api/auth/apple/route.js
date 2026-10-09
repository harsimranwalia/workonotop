import { NextResponse } from 'next/server';
import { execute as query } from '@/lib/db';
import { jwtSecret } from '@/lib/jwt';
import * as jose from 'jose';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS_URL = 'https://appleid.apple.com/auth/keys';

// Create a remote JWK set for verifying Apple tokens
const JWKS = jose.createRemoteJWKSet(new URL(APPLE_JWKS_URL));

export async function POST(request) {
  try {
    // Sessions are signed with the configured JWT_SECRET (src/lib/jwt.js);
    // without it this route answers before it reads the request.
    const secret = jwtSecret();
    const body = await request.json().catch(() => ({}));
    const { token, user: appleUser, role } = body; // token: identityToken, user: { name: { firstName, lastName } }
    console.log(body, '---body')
    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Apple identity token is required' },
        { status: 400 }
      );
    }

    // 1. Verify Apple Token
    let payload;
    try {
      const appleId = process.env.APPLE_ID || 'com.nhaman.workontap';
      const { payload: verifiedPayload } = await jose.jwtVerify(token, JWKS, {
        issuer: APPLE_ISSUER,
        audience: appleId,
      });

      payload = verifiedPayload;
      console.log('✅ [AppleAuth] Token verified successfully for audience:', payload, 'payload',appleId);
    } catch (verifyError) {
      // Decode without verification just to see what the audience was
      const decoded = jose.decodeJwt(token);
      console.error('❌ [AppleAuth] Token verification failed!');
      console.error('   - Expected Audience (from .env):', process.env.APPLE_ID || 'com.nhaman.workontap');
      console.error('   - Received Audience (from Apple):', decoded.aud);
      console.error('   - Error:', verifyError.message);
      
      return NextResponse.json(
        { success: false, message: `Apple token verification failed: ${verifyError.message}` },
        { status: 401 }
      );
    }

    const { email, sub: apple_id } = payload;

    if (!email) {
      console.error('❌ [AppleAuth] No email in payload');
      return NextResponse.json(
        { success: false, message: 'Apple account must have an email address' },
        { status: 400 }
      );
    }

    console.log('✅ [AppleAuth] Token verified for:', email);

    // --- STRICT ROLE DETECTION (Matching Google Logic) ---
    const targetRole = role === 'pro' || role === 'provider' ? 'provider' : 'customer';

    const existingProviders = await query(
      'SELECT * FROM service_providers WHERE email = ?',
      [email]
    );

    const existingUsers = await query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    let finalUser = null;
    let finalRole = null;

    // 🟢 ADMIN BYPASS
    const adminUser = existingUsers.find(u => u.role === 'admin');

    if (adminUser) {
      finalUser = adminUser;
      finalRole = 'admin';
      console.log('👑 Admin Apple login detected');
    } else {
      if (targetRole === 'provider') {
        if (existingProviders.length > 0) {
          finalUser = existingProviders[0];
          finalRole = 'provider';
        } else if (existingUsers.length > 0) {
          return NextResponse.json(
            { success: false, message: 'This email is registered as a customer. Please use the customer login.' },
            { status: 400 }
          );
        }
      } else {
        if (existingUsers.length > 0) {
          finalUser = existingUsers[0];
          finalRole = 'customer';
        } else if (existingProviders.length > 0) {
          return NextResponse.json(
            { success: false, message: 'This email is registered as a service provider. Please use the provider login.' },
            { status: 400 }
          );
        }
      }
    }

    // --- REGISTRATION OR LOGIN PROCEED ---
    if (finalUser) {
      console.log(`📡 [AppleAuth] Existing ${finalRole} found:`, finalUser.email);
      // Update email verification if needed
      if (finalRole === 'provider' && !finalUser.email_verified) {
        await query('UPDATE service_providers SET email_verified = 1 WHERE id = ?', [finalUser.id]);
        finalUser.email_verified = 1;
      }
    } else {
      // Registration logic
      console.log('📝 [AppleAuth] Registering NEW user:', email, 'Target Role:', targetRole);
      
      // Note: Apple provides name ONLY on the first sign-in in the 'user' object from the client
      // We check multiple possible keys for resilience
      const firstName = (appleUser?.name?.firstName || appleUser?.firstName || 'Apple').trim();
      const lastName = (appleUser?.name?.lastName || appleUser?.lastName || 'User').trim();
      const fullName = `${firstName} ${lastName}`.trim();

      if (targetRole === 'provider') {
        const result = await query(
          `INSERT INTO service_providers (name, email, password, status, email_verified, onboarding_step)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [fullName, email, 'apple-auth-placeholder', 'pending', 1, 1]
        );
        const newProvider = await query('SELECT * FROM service_providers WHERE id = ?', [result.insertId]);
        finalUser = newProvider[0];
        finalRole = 'provider';
        console.log('✅ [AppleAuth] New Provider created with ID:', finalUser.id);
      } else {
        const result = await query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role)
           VALUES (?, ?, ?, ?, ?)`,
          [email, 'apple-auth-placeholder', firstName, lastName, 'user']
        );
        const newUser = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        finalUser = newUser[0];
        finalRole = 'customer';
        console.log('✅ [AppleAuth] New Customer created with ID:', finalUser.id);
      }
    }

    // --- GENERATE TOKEN ---
    const tokenPayload = {
      id: finalUser.id,
      email: finalUser.email,
      role: finalRole,
      type: finalRole,
      providerId: finalRole === 'provider' ? finalUser.id : undefined
    };

    const jwtToken = jwt.sign(tokenPayload, secret, { expiresIn: '7d' });
    const refreshToken = crypto.randomBytes(64).toString('hex');

    // --- MOBILE SESSION PERSISTENCE ---
    const deviceId = body.device_id || request.headers.get('x-device-id');
    
    if (deviceId || request.headers.get('user-agent')?.includes('Expo') || request.headers.get('user-agent')?.includes('ReactNative')) {
        try {
            const userIdCol = (finalRole === 'provider') ? 'provider_id' : 'user_id';
            await query(
                `INSERT INTO mobile_auth_users (${userIdCol}, user_type, last_login, device_id, refresh_token, refresh_token_expires)
                 VALUES (?, ?, NOW(), ?, ?, DATE_ADD(NOW(), INTERVAL 365 DAY))
                 ON DUPLICATE KEY UPDATE 
                    last_login = NOW(), 
                    device_id = VALUES(device_id),
                    refresh_token = VALUES(refresh_token),
                    refresh_token_expires = VALUES(refresh_token_expires),
                    user_type = VALUES(user_type)`,
                [finalUser.id, finalRole, deviceId || 'mobile-app', refreshToken]
            );
        } catch (e) {
            console.warn('⚠️ [AppleAuth] Skipping session persistence:', e.message);
        }
    }

    // --- PREPARE RESPONSE ---
    const responseData = {
      success: true,
      message: 'Login successful',
      token: jwtToken,
      refreshToken,
      role: finalRole
    };

    if (finalRole === 'provider') {
      responseData.provider = {
        id: finalUser.id,
        name: finalUser.name,
        email: finalUser.email,
        status: finalUser.status,
        email_verified: 1,
        onboarding_step: finalUser.onboarding_step || 1,
        onboarding_completed: finalUser.onboarding_completed || 0,
        documents_uploaded: finalUser.documents_uploaded || 0,
        stripe_onboarding_complete: finalUser.stripe_onboarding_complete || 0
      };
    } else {
      const { password_hash, ...rest } = finalUser;
      responseData.user = {
        ...rest,
        role: 'customer'
      };
    }

    const response = NextResponse.json(responseData);

    const cookieName = finalRole === 'provider' ? 'provider_token' : 'customer_token';
    response.cookies.set({
      name: cookieName,
      value: jwtToken,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60
    });

    return response;

  } catch (error) {
    console.error('Apple Auth error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error. Please try again.' },
      { status: 500 }
    );
  }
}
