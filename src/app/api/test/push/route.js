import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { notifyUser, sendPushNotification } from '@/lib/push';
import { requireCaller } from '@/lib/api-auth';

export async function POST(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const { userId, role, title, message, token } = body;

    if (token) {
        console.log('[TestPush] Sending to direct token...');
        const result = await sendPushNotification(token, title || 'Test Push', message || 'This is a test notification from WorkOnTap.');
        return NextResponse.json({ success: true, result });
    }

    if (!userId) {
      return NextResponse.json({ success: false, message: 'userId or token is required' }, { status: 400 });
    }

    console.log(`[TestPush] Sending to userId: ${userId}, role: ${role || 'customer'}...`);
    const result = await notifyUser(
        userId, 
        title || 'Test Notification', 
        message || 'This is a test notification from WorkOnTap.', 
        { type: 'test' }, 
        execute, 
        role || 'customer'
    );

    return NextResponse.json({ success: true, result });

  } catch (error) {
    console.error('Test push error:', error);
    return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  }
}
