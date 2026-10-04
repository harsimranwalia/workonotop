import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function POST(request) {
  const auth = await requireCaller(request, ['customer', 'provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const body = await request.json();
    const { userId, userType, pushToken, fcmToken, platform, deviceId } = body;

    const targetToken = fcmToken || pushToken;

    if (!userId || !targetToken) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    // The token is registered for the caller only: the body's userId must be the caller's own id, and a userType, when
    // the body names one, must be the caller's role. Anything else is a 403, never a write for another account.
    if (String(userId) !== String(caller.id) || (userType && userType !== caller.role)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    // Upsert into mobile_auth_users (the row is the caller's own, in the column of the caller's role)
    const userIdCol = caller.role === 'provider' ? 'provider_id' : 'user_id';
    
    // Check if record exists for this user and device
    const existing = await execute(
        `SELECT id FROM mobile_auth_users WHERE ${userIdCol} = ? AND (device_id = ? OR device_id IS NULL) LIMIT 1`,
        [caller.id, deviceId || 'mobile_default']
    );

    if (existing.length > 0) {
        await execute(
            `UPDATE mobile_auth_users SET 
                push_token = ?, 
                push_token_platform = ?, 
                push_token_updated_at = NOW(),
                device_id = ?,
                device_platform = ?,
                updated_at = NOW()
             WHERE id = ?`,
            [targetToken, platform, deviceId || 'mobile_default', platform, existing[0].id]
        );
    } else {
        await execute(
            `INSERT INTO mobile_auth_users 
                (${userIdCol}, user_type, push_token, push_token_platform, push_token_updated_at, device_id, device_platform)
             VALUES (?, ?, ?, ?, NOW(), ?, ?)`,
            [caller.id, caller.role, targetToken, platform, deviceId || 'mobile_default', platform]
        );
    }

    return NextResponse.json({ success: true, message: 'FCM / Push token saved successfully' });

  } catch (error) {
    console.error('Error saving push token:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
