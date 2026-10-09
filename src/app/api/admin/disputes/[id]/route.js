import { NextResponse } from 'next/server'
import { getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth';

export async function GET(request, context) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  const params = await context.params
  const id = params.id
  let connection

  try {
    connection = await getConnection()

    const [[dispute]] = await connection.execute(`
      SELECT 
        d.*,
        b.booking_number, b.service_name, b.service_price, b.authorized_amount,
        b.payment_intent_id, b.provider_id, b.payment_status,
        DATE_FORMAT(b.created_at, '%Y-%m-%d %H:%i:%s') as booking_created_at,
        sp.stripe_account_id,
        CONCAT(u.first_name, ' ', u.last_name) as customer_name,
        u.email as customer_email,
        sp.name as provider_name,
        sp.email as provider_email
      FROM disputes d
      LEFT JOIN bookings b ON d.booking_id = b.id
      LEFT JOIN users u ON d.raised_by_user_id = u.id
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      WHERE d.id = ?
    `, [id])

    connection.release()

    if (!dispute) {
      return NextResponse.json({ success: false, message: 'Dispute not found' }, { status: 404 })
    }

    return NextResponse.json({ success: true, dispute })

  } catch (error) {
    console.error('Admin disputes single GET error:', error)
    if (connection) connection.release()
    return NextResponse.json({ success: false, message: 'Failed to load dispute' }, { status: 500 })
  }
}
