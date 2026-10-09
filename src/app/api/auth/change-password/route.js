import { NextResponse } from 'next/server';
import { execute as query } from '@/lib/db';
import bcrypt from 'bcryptjs';
import { requireCaller } from '@/lib/api-auth';

export async function POST(request) {
  const auth = await requireCaller(request, ['customer', 'provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    const { oldPassword, newPassword } = await request.json();

    if (!oldPassword || !newPassword) {
      return NextResponse.json({ success: false, message: 'Current and new passwords are required' }, { status: 400 });
    }

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
    if (!passwordRegex.test(newPassword)) {
      return NextResponse.json({ success: false, message: 'Password must be at least 8 characters and contain both alphabets and special characters' }, { status: 400 });
    }

    // 1. Fetch the caller's own row to check the current password, in the table of the caller's role
    // (a customer's id is a users.id and a provider's a service_providers.id; the two id spaces overlap, so the role decides)
    let user = null;
    let table = 'users';
    let passCol = 'password_hash';
    if (caller.role === 'provider') {
      table = 'service_providers';
      passCol = 'password';
    }

    const rows = await query(`SELECT id, ${passCol} FROM ${table} WHERE id = ?`, [caller.id]);
    if (rows.length > 0) {
      user = rows[0];
    }

    if (!user) {
      return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
    }

    // 2. Verify current password
    const currentHash = user.password_hash || user.password;
    const isMatch = await bcrypt.compare(oldPassword, currentHash);
    if (!isMatch) {
      return NextResponse.json({ success: false, message: 'Incorrect current password' }, { status: 401 });
    }

    // 3. Hash new password and update
    const salt = await bcrypt.genSalt(10);
    const newHash = await bcrypt.hash(newPassword, salt);

    await query(`UPDATE ${table} SET ${passCol} = ?, updated_at = NOW() WHERE id = ?`, [newHash, caller.id]);

    return NextResponse.json({ success: true, message: 'Password updated successfully' });

  } catch (error) {
    console.error('Error changing password:', error);
    return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
  }
}
