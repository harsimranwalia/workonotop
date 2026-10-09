import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { logActivity } from '@/lib/logger'
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
    const auth = await requireCaller(request, ['admin']);
    if (!auth.ok) return auth.response;

    try {
        const results = await execute('SELECT `key`, `value` FROM system_settings')
        const settings = {}
        results.forEach(r => {
            settings[r.key] = r.value
        })
        return NextResponse.json({ success: true, settings })
    } catch (error) {
        console.error('Error fetching settings:', error)
        return NextResponse.json({ success: false, message: 'Failed to fetch settings' }, { status: 500 })
    }
}

export async function POST(request) {
    const auth = await requireCaller(request, ['admin']);
    if (!auth.ok) return auth.response;

    try {
        const body = await request.json()
        const { key, value } = body
        console.log('Admin Settings POST:', { key, value })
        
        if (!key) return NextResponse.json({ success: false, message: 'Key is required' }, { status: 400 })

        await execute(
            'INSERT INTO system_settings (`key`, `value`) VALUES (?, ?) ON DUPLICATE KEY UPDATE `value` = ?',
            [key, value, value]
        )

        // Log Activity
        logActivity({
            actor_id: auth.caller.id,
            actor_type: 'admin',
            actor_name: 'Admin', // Would need an extra query to get first/last name, fallback to Admin
            action: 'SYSTEM_SETTINGS_UPDATED',
            entity_type: 'system',
            entity_id: 1,
            details: { key, value }
        })

        return NextResponse.json({ success: true, message: 'Setting updated' })
    } catch (error) {
        console.error('Error updating setting:', error)
        return NextResponse.json({ success: false, message: 'Failed to update setting' }, { status: 500 })
    }
}
