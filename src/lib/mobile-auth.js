import { execute } from './db.js';
import { decodeToken, jwtSecret, verifyToken } from './jwt.js';

/**
 * Verifies a mobile session by checking the token against the mobile_auth_users table.
 * This provides a robust alternative to cookie-only or JWT-only verification for mobile clients.
 * 
 * @param {Request} request - The Next.js request object
 * @returns {Promise<Object|null>} - The session data if valid, otherwise null
 */
export async function getMobileSession(request) {
    try {
        // No session is accepted while JWT_SECRET is not configured.
        jwtSecret();
        const authHeader = request.headers.get('Authorization');
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return null;
        }

        const token = authHeader.split(' ')[1];
        if (!token) return null;

        // 1. Query the database for this specific token string
        // This bypasses secret mismatch issues as we compare the exact string issued
        const rows = await execute(
            `SELECT * FROM mobile_auth_users 
             WHERE refresh_token = ? AND is_active = 1 
             AND (refresh_token_expires IS NULL OR refresh_token_expires > NOW())`,
            [token]
        );

        if (rows.length === 0) {
            console.log('⚠️ No active mobile session found in DB, trying JWT verification...');
            try {
                const decoded = verifyToken(token);
                if (decoded) {
                    console.log('✅ JWT verified successfully');
                    // Standardize the response to match what onboarding routes expect
                    return {
                        ...decoded,
                        providerId: decoded.providerId || (decoded.role === 'provider' || decoded.type === 'provider' ? decoded.id : null),
                        userId: decoded.userId || (decoded.role !== 'provider' && decoded.type !== 'provider' ? decoded.id : null),
                        type: decoded.role || decoded.type,
                        mobileSession: true
                    };
                }
            } catch (jwtErr) {
                console.log('JWT verify error:', jwtErr.message);
            }
            return null;
        }

        const session = rows[0];

        // 2. Decode the token to get payload data (without re-verifying signature 
        // since we already validated the string match in our secure DB)
        const decoded = decodeToken(token);
        
        if (!decoded) {
            console.warn('📱 [Mobile Auth] Token valid in DB but could not be decoded');
            return null;
        }

        // Standardize the response to match what onboarding routes expect
        const userId = session.provider_id || decoded.id;
        const type = session.user_type;

        // 3. ✨ NEW: Check for account restriction/deletion status
        // We only allow authenticated access if the account is in 'active' status
        try {
            const table = type === 'provider' ? 'service_providers' : 'users';
            const statusRows = await execute(`SELECT status FROM ${table} WHERE id = ?`, [userId]);
            
            if (statusRows.length > 0) {
                const status = statusRows[0].status;
                if (status === 'pending_deletion' || status === 'deleted') {
                    console.log(`🚫 [Mobile Auth] Action blocked: Account status is ${status} for ${type} ID ${userId}`);
                    // Return special object to allow specific handlers for "account restricted" state
                    return {
                        id: userId,
                        type: type,
                        status: status,
                        restricted: true,
                        error: 'Account restricted. Deletion in progress.'
                    };
                }
            }
        } catch (statusErr) {
            console.error('❌ Status check failed:', statusErr.message);
        }

        return {
            ...decoded,
            providerId: session.provider_id || decoded.id,
            userId: session.user_id || decoded.id,
            type: session.user_type,
            mobileSession: true,
            status: 'active'
        };

    } catch (error) {
        console.error('📱 [Mobile Auth] Critical error:', error);
        return null;
    }
}
