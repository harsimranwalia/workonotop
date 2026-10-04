import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

// The settings are always the caller's own row. A user_id or provider_id (compared as strings) that names anyone
// else is a 403, never a 404 (the mobile app logs the user out on a "not found").
const namesAnotherAccount = (caller, ...ids) =>
  ids.some((id) => id !== null && id !== undefined && id !== '' && String(id) !== String(caller.id));

export async function GET(request) {
  const auth = await requireCaller(request, ['customer', 'provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { searchParams } = new URL(request.url);
    if (namesAnotherAccount(caller, searchParams.get('user_id'), searchParams.get('provider_id'))) return forbidden();

    // Determine target table based on the caller's role (a customer's row is in users, a provider's in service_providers)
    const isProvider = caller.role === 'provider';
    const tableName = isProvider ? 'service_providers' : 'users';
    const userId = caller.id;

    console.log(`Fetching settings for ${isProvider ? 'provider' : 'user'} ID: ${userId}`);

    const results = await execute(
      `SELECT push_notifications_enabled, booking_reminders_enabled, dark_mode_enabled, receive_offers FROM ${tableName} WHERE id = ?`,
      [userId]
    );

    if (results.length === 0) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
        success: true,
        data: {
            push_notifications_enabled: !!results[0].push_notifications_enabled,
            booking_reminders_enabled: !!results[0].booking_reminders_enabled,
            dark_mode_enabled: !!results[0].dark_mode_enabled,
            receive_offers: !!results[0].receive_offers
        }
    });

  } catch (error) {
    console.error('Error fetching settings:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}

export async function PUT(request) {
  const auth = await requireCaller(request, ['customer', 'provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    // Determine target table based on the caller's role
    const isProvider = caller.role === 'provider';
    const tableName = isProvider ? 'service_providers' : 'users';
    const userId = caller.id;

    const body = await request.json();
    if (namesAnotherAccount(caller, body.user_id, body.provider_id)) return forbidden();
    const { push_notifications_enabled, booking_reminders_enabled, dark_mode_enabled, receive_offers } = body;

    const queryParams = [];
    const fields = [];

    if (push_notifications_enabled !== undefined) {
      fields.push('push_notifications_enabled = ?');
      queryParams.push(push_notifications_enabled ? 1 : 0);
    }
    if (booking_reminders_enabled !== undefined) {
      fields.push('booking_reminders_enabled = ?');
      queryParams.push(booking_reminders_enabled ? 1 : 0);
    }
    if (dark_mode_enabled !== undefined) {
      fields.push('dark_mode_enabled = ?');
      queryParams.push(dark_mode_enabled ? 1 : 0);
    }
    if (receive_offers !== undefined) {
      fields.push('receive_offers = ?');
      queryParams.push(receive_offers ? 1 : 0);
    }

    if (fields.length === 0) {
      return NextResponse.json({ success: false, message: 'No fields to update' }, { status: 400 });
    }

    queryParams.push(userId);
    await execute(`UPDATE ${tableName} SET ${fields.join(', ')} WHERE id = ?`, queryParams);

    return NextResponse.json({ success: true, message: 'Settings updated successfully' });

  } catch (error) {
    console.error('Error updating settings:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
