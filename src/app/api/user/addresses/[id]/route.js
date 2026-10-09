import { NextResponse } from 'next/server';
import { execute as query } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

const forbidden = () => NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { id } = await params;

    const body = await request.json();
    const { name, address_line1, address_line2, city, postal_code, is_default } = body;

    // Check ownership: an address that does not exist is the route's 404; one that exists and is not the caller's is a 403, never a 404.
    const existing = await query('SELECT id, user_id FROM user_addresses WHERE id = ?', [id]);
    if (existing.length === 0) {
      return NextResponse.json({ success: false, message: 'Address not found' }, { status: 404 });
    }
    if (String(existing[0].user_id) !== String(caller.id)) return forbidden();

    // If setting as default, unset others first
    if (is_default) {
      await query('UPDATE user_addresses SET is_default = 0 WHERE user_id = ?', [caller.id]);
    }

    const queryParams = [];
    const fields = [];

    if (name) { fields.push('name = ?'); queryParams.push(name); }
    if (address_line1) { fields.push('address_line1 = ?'); queryParams.push(address_line1); }
    if (address_line2 !== undefined) { fields.push('address_line2 = ?'); queryParams.push(address_line2); }
    if (city) { fields.push('city = ?'); queryParams.push(city); }
    if (postal_code !== undefined) { fields.push('postal_code = ?'); queryParams.push(postal_code); }
    if (is_default !== undefined) { fields.push('is_default = ?'); queryParams.push(is_default ? 1 : 0); }

    if (fields.length > 0) {
      queryParams.push(id);
      await query(`UPDATE user_addresses SET ${fields.join(', ')} WHERE id = ?`, queryParams);
    }

    return NextResponse.json({ success: true, message: 'Address updated successfully' });

  } catch (error) {
    console.error('Error updating address:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { id } = await params;

    // Check ownership: an address that does not exist is the route's 404; one that exists and is not the caller's is a 403, never a 404.
    const existing = await query('SELECT id, user_id FROM user_addresses WHERE id = ?', [id]);
    if (existing.length === 0) {
      return NextResponse.json({ success: false, message: 'Address not found or unauthorized' }, { status: 404 });
    }
    if (String(existing[0].user_id) !== String(caller.id)) return forbidden();

    await query('DELETE FROM user_addresses WHERE id = ?', [id]);

    return NextResponse.json({ success: true, message: 'Address deleted successfully' });

  } catch (error) {
    console.error('Error deleting address:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
