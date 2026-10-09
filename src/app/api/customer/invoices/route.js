import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request) {
  const auth = await requireCaller(request, ['customer']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    const { searchParams } = new URL(request.url)
    let userId = searchParams.get('user_id')
    const email = searchParams.get('email')
    // 'null' and 'undefined' are what a caller with no id sends; the old query read them as no user_id, and they name no one.
    if (userId === 'null' || userId === 'undefined') userId = null

    // The customer is the caller: a user_id (compared as strings) or an email (compared without case) that names anyone
    // else is a 403, never a 404. None at all means their own invoices.
    if (userId && String(userId) !== String(caller.id)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }
    if (email && String(email).toLowerCase() !== String(caller.email ?? '').toLowerCase()) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }

    let sql = `
      SELECT 
        i.*,
        s.name as service_name
      FROM invoices i
      JOIN bookings b ON i.booking_id = b.id
      JOIN services s ON b.service_id = s.id
      WHERE i.invoice_type = 'customer'
    `
    const params = []

    // Ownership comes from the caller (the booking's user_id), never from a parameter.
    sql += ' AND b.user_id = ?'
    params.push(caller.id)

    sql += ' ORDER BY i.created_at DESC'

    // Fetch invoices for this user with service details
    const invoices = await execute(sql, params)

    return NextResponse.json({ 
      success: true, 
      data: invoices 
    })

  } catch (error) {
    console.error('Error fetching customer invoices:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to fetch invoices' 
    }, { status: 500 })
  }
}
