import { NextResponse } from 'next/server';
import { execute, getConnection } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function PUT(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { providerId } = await params;
    const { name, phone, email } = await request.json();

    if (!name || !email) {
      return NextResponse.json({ success: false, message: 'Name and email are required' }, { status: 400 });
    }

    // Check if email is already taken by another provider
    const existing = await execute('SELECT id FROM service_providers WHERE email = ? AND id != ?', [email, providerId]);
    if (existing.length > 0) {
      return NextResponse.json({ success: false, message: 'Email already in use' }, { status: 400 });
    }

    await execute(
      `UPDATE service_providers SET name = ?, phone = ?, email = ?, updated_at = NOW() WHERE id = ?`,
      [name, phone || null, email, providerId]
    );

    return NextResponse.json({ success: true, message: 'Provider updated successfully' });
  } catch (error) {
    console.error('Error updating provider:', error);
    return NextResponse.json({ success: false, message: 'Failed to update provider: ' + error.message }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  let connection;
  try {
    const { providerId } = await params;

    connection = await getConnection();
    await connection.beginTransaction();

    try {
      // 1. Get all booking IDs for this provider
      const [bookingRows] = await connection.execute(
        `SELECT id FROM bookings WHERE provider_id = ?`, [providerId]
      );
      const bookingIds = bookingRows.map(b => b.id);

      if (bookingIds.length > 0) {
        const placeholders = bookingIds.map(() => '?').join(',');

        // Delete related booking data (photos, history, logs, etc.)
        await connection.execute(`DELETE FROM chat_messages WHERE booking_id IN (${placeholders})`, bookingIds);
        await connection.execute(`DELETE FROM booking_photos WHERE booking_id IN (${placeholders})`, bookingIds);
        await connection.execute(`DELETE FROM booking_status_history WHERE booking_id IN (${placeholders})`, bookingIds);
        await connection.execute(`DELETE FROM booking_time_logs WHERE booking_id IN (${placeholders})`, bookingIds);
        await connection.execute(`DELETE FROM job_photos WHERE booking_id IN (${placeholders})`, bookingIds);
        await connection.execute(`DELETE FROM invoices WHERE booking_id IN (${placeholders})`, bookingIds);
        await connection.execute(`DELETE FROM provider_reviews WHERE booking_id IN (${placeholders})`, bookingIds);

        // Delete the bookings
        await connection.execute(`DELETE FROM bookings WHERE id IN (${placeholders})`, bookingIds);
      }

      // 2. Delete provider documents
      await connection.execute(`DELETE FROM provider_documents WHERE provider_id = ?`, [providerId]);

      // 3. Delete provider bank accounts
      await connection.execute(`DELETE FROM provider_bank_accounts WHERE provider_id = ?`, [providerId]);

      // 4. Delete the provider themselves
      await connection.execute(`DELETE FROM service_providers WHERE id = ?`, [providerId]);

      await connection.commit();
      return NextResponse.json({ success: true, message: 'Provider and all associated data deleted successfully' });

    } catch (innerError) {
      await connection.rollback();
      throw innerError;
    }
  } catch (error) {
    console.error('Error deleting provider:', error);
    return NextResponse.json({ success: false, message: 'Failed to delete provider: ' + error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}
