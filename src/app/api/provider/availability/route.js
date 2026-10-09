import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

// GET — return is_available status
export async function GET(request) {
    const auth = await requireCaller(request, ['provider']);
    if (!auth.ok) return auth.response;
    try {
        const providerId = auth.caller.id;
        const rows = await execute(
            'SELECT is_available FROM service_providers WHERE id = ?',
            [providerId]
        );

        return NextResponse.json({
            success: true,
            is_available: rows[0]?.is_available === 1 || rows[0]?.is_available === true,
        });
    } catch (error) {
        console.error('Availability GET error:', error);
        return NextResponse.json({ success: false, message: 'Server error' }, { status: 500 });
    }
}

// POST/PUT — toggle is_available
export async function POST(request) {
    const auth = await requireCaller(request, ['provider']);
    if (!auth.ok) return auth.response;
    return await handleToggle(request, auth.caller);
}

export async function PUT(request) {
    const auth = await requireCaller(request, ['provider']);
    if (!auth.ok) return auth.response;
    return await handleToggle(request, auth.caller);
}

// The guard has run in POST and PUT; the flag it writes is the caller's own row, never an id from the request.
async function handleToggle(request, caller) {
    try {
        const providerId = caller.id;
        const { is_available } = await request.json();

        // Try to update; if column doesn't exist, add it first
        try {
            await execute(
                'UPDATE service_providers SET is_available = ?, updated_at = NOW() WHERE id = ?',
                [is_available ? 1 : 0, providerId]
            );
        } catch (colErr) {
            console.log('Column is_available might be missing, attempting to add...');
            try {
                // MySQL 8.0.19+ supports IF NOT EXISTS, but for older versions we just try and ignore error if it exists
                await execute(
                    'ALTER TABLE service_providers ADD COLUMN is_available TINYINT(1) DEFAULT 1 AFTER status'
                );
            } catch (alterError) {
                // If it already exists, this might error, which is fine
                console.log('ALTER TABLE note:', alterError.message);
            }
            
            await execute(
                'UPDATE service_providers SET is_available = ?, updated_at = NOW() WHERE id = ?',
                [is_available ? 1 : 0, providerId]
            );
        }

        return NextResponse.json({ 
            success: true, 
            is_available: !!is_available,
            message: `You are now ${is_available ? 'Online' : 'Offline'}`
        });
    } catch (error) {
        console.error('Availability update error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Server error' }, { status: 500 });
    }
}
