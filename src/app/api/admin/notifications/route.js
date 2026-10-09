import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
    const auth = await requireCaller(request, ['admin']);
    if (!auth.ok) return auth.response;
    try {
        const notifications = await execute(
            `SELECT * FROM notifications
             WHERE user_id = ? AND user_type = 'admin'
             ORDER BY created_at DESC
             LIMIT 50`,
            [auth.caller.id]
        );

        return NextResponse.json({ success: true, data: notifications });

    } catch (error) {
        console.error('Admin notifications error:', error);
        return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
    }
}

export async function PUT(request) {
    const auth = await requireCaller(request, ['admin']);
    if (!auth.ok) return auth.response;
    try {
        const { id, all } = await request.json();

        if (all) {
            await execute(
                `UPDATE notifications SET is_read = 1 WHERE user_id = ? AND user_type = 'admin'`,
                [auth.caller.id]
            );
        } else if (id) {
            await execute(
                `UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ? AND user_type = 'admin'`,
                [id, auth.caller.id]
            );
        }

        return NextResponse.json({ success: true });

    } catch (error) {
        console.error('Admin notifications update error:', error);
        return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
    }
}
