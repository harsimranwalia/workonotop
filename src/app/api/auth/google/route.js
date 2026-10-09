import { NextResponse } from 'next/server';
import { execute as query } from '@/lib/db';
import { jwtSecret } from '@/lib/jwt';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

export async function POST(request) {
  try {
    // Sessions are signed with the configured JWT_SECRET (src/lib/jwt.js);
    // without it this route answers before it reads the request.
    const secret = jwtSecret();
    const body = await request.json().catch(() => ({}));
    const { token, role } = body; // role: 'user' or 'provider'

    if (!token) {
      return NextResponse.json(
        { success: false, message: 'Google token is required' },
        { status: 400 }
      );
    }

    // Verify Google Token
    const googleRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${token}`);
    const googleData = await googleRes.json();

    if (googleData.error_description) {
      return NextResponse.json(
        { success: false, message: 'Invalid Google token' },
        { status: 401 }
      );
    }

    const { email, given_name, family_name, name, picture, sub: google_id, aud, phone_number } = googleData;

    // Verify audience (must match our client id)
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    const androidClientId = process.env.GOOGLE_CLIENT_ID_ANDROID;

    if (aud !== clientId && aud !== androidClientId) {
      console.error('❌ [GoogleAuth] Audience mismatch!', {
        received_aud: aud,
        expected: {
          web: clientId,
          android: androidClientId
        }
      });
      return NextResponse.json(
        { success: false, message: `Security verification failed: Audience mismatch. Received: ${aud}. Expected Web: ${clientId}, Android: ${androidClientId}` },
        { status: 403 }
      );
    }

    console.log('✅ [GoogleAuth] Audience verified:', aud === clientId ? 'Web' : 'Android');

    // --- STRICT ROLE DETECTION ---
    const targetRole = role === 'pro' || role === 'provider' ? 'provider' : 'customer';

    // 1. Check if user exists as a Provider
    const existingProviders = await query(
      'SELECT * FROM service_providers WHERE email = ?',
      [email]
    );

    // 2. Check if user exists as a Customer
    const existingUsers = await query(
      'SELECT * FROM users WHERE email = ?',
      [email]
    );

    let finalUser = null;
    let finalRole = null;

    // 🟢 ADMIN BYPASS (Detection)
    const adminUser = existingUsers.find(u => u.role === 'admin');

    if (adminUser) {
      finalUser = adminUser;
      finalRole = 'admin';
      console.log('👑 Admin Google login detected');
    } else {
      // 2. STRICT ROLE DETECTION (for regular users)
      if (targetRole === 'provider') {
        if (existingProviders.length > 0) {
          finalUser = existingProviders[0];
          finalRole = 'provider';
        } else if (existingUsers.length > 0) {
          // Strict Block: User exists as customer but tried to login as provider
          return NextResponse.json(
            { success: false, message: 'This email is registered as a customer. Please use the customer login.' },
            { status: 400 }
          );
        }
      } else {
        // targetRole === 'customer'
        if (existingUsers.length > 0) {
          finalUser = existingUsers[0];
          finalRole = 'customer';
        } else if (existingProviders.length > 0) {
          // Strict Block: User exists as provider but tried to login as customer
          return NextResponse.json(
            { success: false, message: 'This email is registered as a service provider. Please use the provider login.' },
            { status: 400 }
          );
        }
      }
    }

    // --- REGISTRATION OR LOGIN PROCEED ---
    if (finalUser) {
      // Existing user logic
      if (finalRole === 'provider' && !finalUser.email_verified) {
        await query('UPDATE service_providers SET email_verified = 1 WHERE id = ?', [finalUser.id]);
        finalUser.email_verified = 1;
      }
    } else {
      // Registration logic (Neither account exists)
      if (targetRole === 'provider') {
        const result = await query(
          `INSERT INTO service_providers (name, email, password, phone, status, email_verified, avatar_url, onboarding_step)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [name || `${given_name} ${family_name}`, email, 'google-auth-placeholder', phone_number || null, 'pending', 1, picture, 1]
        );
        const newProvider = await query('SELECT * FROM service_providers WHERE id = ?', [result.insertId]);
        finalUser = newProvider[0];
        finalRole = 'provider';
      } else {
        const result = await query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, image_url)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [email, 'google-auth-placeholder', given_name || '', family_name || '', 'user', picture]
        );
        const newUser = await query('SELECT * FROM users WHERE id = ?', [result.insertId]);
        finalUser = newUser[0];
        finalRole = 'customer';
      }
    }

    // --- GENERATE TOKEN ---
    const tokenPayload = {
      id: finalUser.id,
      email: finalUser.email,
      role: finalRole,
      type: finalRole, // For backward compatibility
      providerId: finalRole === 'provider' ? finalUser.id : undefined // Critical for onboarding routes
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
            console.log('📱 [GoogleAuth] Mobile session persisted to DB');
        } catch (e) {
            console.warn('⚠️ [GoogleAuth] Skipping session persistence:', e.message);
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
        role: 'customer' // Normalize 'user' to 'customer' for mobile
      };
    }

    const response = NextResponse.json(responseData);

    // Set cookie for web compatibility
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
    console.error('Google Auth error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error. Please try again.' },
      { status: 500 }
    );
  }
}
