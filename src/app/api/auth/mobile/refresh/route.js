import { NextResponse } from 'next/server'
import { execute as query } from '@/lib/db'
import { jwtSecret } from '@/lib/jwt'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'

export async function POST(request) {
    try {
        // Sessions are signed with the configured JWT_SECRET (src/lib/jwt.js);
        // without it this route answers before it reads the request.
        const secret = jwtSecret();
        const body = await request.json().catch(() => ({}));
        const { refreshToken } = body;

        if (!refreshToken) {
            return NextResponse.json(
                { success: false, message: 'Refresh token is required' },
                { status: 400 }
            );
        }

        // Find the refresh token in the database
        const sessions = await query(
            `SELECT * FROM mobile_auth_users 
             WHERE refresh_token = ? 
             AND refresh_token_expires > NOW() 
             AND is_active = 1`,
            [refreshToken]
        );

        if (sessions.length === 0) {
            return NextResponse.json(
                { success: false, message: 'Invalid or expired refresh token' },
                { status: 401 }
            );
        }

        const session = sessions[0];

        // The role comes from the account row the session points to.
        let user = null;
        let dbRole = null;

        if (session.provider_id != null) {
            const providers = await query('SELECT * FROM service_providers WHERE id = ?', [session.provider_id]);
            if (providers.length > 0) { user = providers[0]; dbRole = 'provider'; }
        } else if (session.user_id != null) {
            const rows = await query('SELECT * FROM users WHERE id = ?', [session.user_id]);
            if (rows.length > 0) { user = rows[0]; dbRole = rows[0].role === 'admin' ? 'admin' : 'customer'; }
        }

        if (!user) {
            return NextResponse.json(
                { success: false, message: 'User not found' },
                { status: 404 }
            );
        }

        // Validate provider verification status if applicable
        if (dbRole === 'provider' && !user.email_verified && user.status !== 'active') {
            return NextResponse.json(
                { success: false, message: 'Please verify your email first' },
                { status: 403 }
            );
        }

        // Generate NEW JWT access token
        const newAccessToken = jwt.sign(
            {
                id: user.id,
                providerId: dbRole === 'provider' ? user.id : undefined,
                email: user.email,
                first_name: user.first_name || user.name,
                last_name: user.last_name || '',
                role: dbRole,
                status: user.status || 'active',
                type: dbRole
            },
            secret,
            { expiresIn: '7d' } // Access token valid for 7 days
        );

        // Generate NEW refresh token (Token Rotation)
        const newRefreshToken = crypto.randomBytes(64).toString('hex');

        // Update session in DB
        await query(
            `UPDATE mobile_auth_users 
             SET refresh_token = ?, 
                 refresh_token_expires = DATE_ADD(NOW(), INTERVAL 365 DAY),
                 last_login = NOW()
             WHERE id = ?`,
            [newRefreshToken, session.id]
        );

        console.log(`✅ Session refreshed successfully for ${dbRole} ID: ${user.id}`);

        // Return new tokens to client
        return NextResponse.json({
            success: true,
            token: newAccessToken,
            refreshToken: newRefreshToken
        });

    } catch (error) {
        console.error('Refresh Token Error:', error);
        return NextResponse.json(
            { success: false, message: 'Server error during token refresh' },
            { status: 500 }
        );
    }
}
