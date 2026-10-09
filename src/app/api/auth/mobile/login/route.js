import { NextResponse } from 'next/server'
import { execute as query } from '@/lib/db'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'

export async function POST(request) {
    try {
        const body = await request.json().catch(() => ({}));
        const { email, password, role: requestedRole, device_id = 'mobile_default' } = body;
        console.log('Mobile login attempt:', { email, requestedRole, device_id });

        if (!email || !password || !requestedRole) {
            return NextResponse.json(
                { success: false, message: 'Email, password, and role are required' },
                { status: 400 }
            )
        }

        const targetRole = (requestedRole === 'pro' || requestedRole === 'provider') ? 'provider' : 'customer';

        let user = null;
        let dbRole = null;

        // 1. Check BOTH tables to detect role
        const users = await query('SELECT * FROM users WHERE email = ?', [email]);
        const providers = await query('SELECT * FROM service_providers WHERE email = ?', [email]);

        const hasCustomerAccount = users.length > 0;
        const hasProviderAccount = providers.length > 0;

        // 🟢 ADMIN BYPASS (Detection)
        const adminUser = users.find(u => u.role === 'admin');

        if (adminUser) {
            user = adminUser;
            dbRole = 'admin';
            console.log('👑 Admin login detected via mobile app');
        } else {
            // 2. STRICT ROLE VALIDATION (for regular users)
            if (targetRole === 'provider') {
                if (hasProviderAccount) {
                    user = providers[0];
                    dbRole = 'provider';
                    user.password_hash = user.password; // Map for bcrypt
                } else if (hasCustomerAccount) {
                    return NextResponse.json(
                        { success: false, message: 'This email is registered as a customer. Please use the customer login screen.' },
                        { status: 403 }
                    );
                }
            } else {
                // targetRole === 'customer'
                if (hasCustomerAccount) {
                    user = users[0];
                    dbRole = user.role;
                } else if (hasProviderAccount) {
                    return NextResponse.json(
                        { success: false, message: 'This email is registered as a professional. Please use the pro login screen.' },
                        { status: 403 }
                    );
                }
            }
        }

        if (!user) {
            return NextResponse.json(
                { success: false, message: 'Invalid credentials' },
                { status: 401 }
            )
        }

        // Check password
        const isMatch = await bcrypt.compare(password, user.password_hash)
        if (!isMatch) {
            return NextResponse.json(
                { success: false, message: 'Invalid credentials' },
                { status: 401 }
            )
        }

        // Check if provider is verified or approved (skipped for customers/admins)
        if (dbRole === 'provider' && !user.email_verified && user.status !== 'active') {
            return NextResponse.json(
                { success: false, message: 'Please verify your email first', requiresVerification: true, email: user.email },
                { status: 403 }
            )
        }

        // Generate JWT token
        const token = jwt.sign(
            {
                id: user.id,
                providerId: dbRole === 'provider' ? user.id : undefined,
                email: user.email,
                first_name: user.first_name || user.name,
                last_name: user.last_name || '',
                role: dbRole,
                status: user.status || 'active',
                type: dbRole // Added for compatibility with provider middleware/routes
            },
            JWT_SECRET,
            { expiresIn: '7d' }
        )

        // Remove password fields from response
        const { password_hash, password: p, ...userData } = user
        userData.role = dbRole;

        // Generate a secure Refresh Token for mobile sessions
        const refreshToken = crypto.randomBytes(64).toString('hex');

        // Create response
        const response = NextResponse.json({
            success: true,
            message: `${dbRole.charAt(0).toUpperCase() + dbRole.slice(1)} login successful`,
            token,
            refreshToken, // Send refresh token back to client
            user: userData
        })

        // 🔥 Save session to mobile_auth_users table for mobile API verification
        try {
            // Map roles to database enum ('customer', 'provider', 'admin')
            let dbType = 'customer';
            if (dbRole === 'provider') dbType = 'provider';
            else if (dbRole === 'admin') dbType = 'admin';

            const userIdCol = (dbType === 'provider') ? 'provider_id' : 'user_id';
            
            // Note: device_id is part of unique index.
            const finalDeviceId = device_id || 'mobile_default';

            await query(
                `INSERT INTO mobile_auth_users 
                 (${userIdCol}, user_type, refresh_token, refresh_token_expires, is_active, last_login, device_id)
                 VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 365 DAY), 1, NOW(), ?)
                 ON DUPLICATE KEY UPDATE 
                 refresh_token = VALUES(refresh_token),
                 refresh_token_expires = VALUES(refresh_token_expires),
                 user_type = VALUES(user_type),
                 is_active = 1,
                 last_login = NOW()`,
                [user.id, dbType, refreshToken, finalDeviceId]
            );
            console.log(`✅ Mobile session persisted for ${dbType} ID: ${user.id}`);
        } catch (dbError) {
            console.error('❌ Failed to persist mobile session:', dbError.message);
        }

        // Set HTTP-only cookie based on role (for web support)
        const cookieOptions = {
            value: token,
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            sameSite: 'lax',
            path: '/',
            maxAge: 7 * 24 * 60 * 60 // 7 days
        };

        if (dbRole === 'admin') {
            response.cookies.set({ name: 'adminAuth', ...cookieOptions })
        } else if (dbRole === 'provider') {
            response.cookies.set({ name: 'provider_token', ...cookieOptions })
        } else {
            response.cookies.set({ name: 'customer_token', ...cookieOptions })
        }

        return response

    } catch (error) {
        console.error('Mobile login error:', error)
        return NextResponse.json(
            { success: false, message: 'Server error. Please try again.' },
            { status: 500 }
        )
    }
}
