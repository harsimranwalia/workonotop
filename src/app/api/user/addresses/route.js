import { NextResponse } from 'next/server';
import { execute as query } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

// A customer may name only themselves: a user_id (compared as strings) that names anyone else is a 403, never a 404
// (the mobile app logs the user out on a "not found"). The addresses are always the caller's own.
const namesAnotherAccount = (caller, userId) =>
  userId !== null && userId !== undefined && userId !== '' && String(userId) !== String(caller.id);

export async function GET(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    if (namesAnotherAccount(caller, new URL(request.url).searchParams.get('user_id'))) return forbidden();

    const results = await query(
      'SELECT * FROM user_addresses WHERE user_id = ? ORDER BY is_default DESC, created_at DESC',
      [caller.id]
    );

    return NextResponse.json({ success: true, data: results });

  } catch (error) {
    console.error('Error fetching addresses:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const body = await request.json();
    const { name, address_line1, address_line2, city, postal_code, is_default, user_id } = body;

    // The address is written for the caller; a body user_id naming anyone else is refused.
    if (namesAnotherAccount(caller, user_id)) return forbidden();

    if (!name || !address_line1 || !city) {
      return NextResponse.json({ success: false, message: 'Missing required fields' }, { status: 400 });
    }

    // If setting as default, unset others first
    if (is_default) {
      await query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [caller.id]);
    }

    const result = await query(
      `INSERT INTO user_addresses (user_id, name, address_line1, address_line2, city, postal_code, is_default)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [caller.id, name, address_line1, address_line2 || null, city, postal_code || null, is_default ? 1 : 0]
    );

    return NextResponse.json({ 
      success: true, 
      message: 'Address added successfully', 
      data: { id: result.insertId } 
    });

  } catch (error) {
    console.error('Error creating address:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
