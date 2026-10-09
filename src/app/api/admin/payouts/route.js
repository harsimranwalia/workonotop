import { NextResponse } from 'next/server'
import { getConnection } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  let connection
  try {
    connection = await getConnection()

    // 1. Get all providers with balances
    const [providers] = await connection.execute(`
      SELECT 
        id,
        name,
        email,
        COALESCE(total_earnings, 0) as total_earnings,
        COALESCE(available_balance, 0) as available_balance,
        COALESCE(pending_balance, 0) as pending_balance,
        COALESCE(lifetime_balance, 0) as lifetime_balance,
        stripe_onboarding_complete
      FROM service_providers
      WHERE status = 'active'
      ORDER BY total_earnings DESC
    `)

    // 2. Get all payouts with provider and booking details
    const [payouts] = await connection.execute(`
      SELECT 
        pp.id,
        pp.amount,
        pp.status,
        pp.stripe_payout_id,
        pp.stripe_transfer_id,
        DATE_FORMAT(pp.created_at, '%Y-%m-%d %H:%i:%s') as created_at,
        DATE_FORMAT(pp.paid_at, '%Y-%m-%d %H:%i:%s') as paid_at,
        pp.notes,
        pp.booking_id,
        b.booking_number,
        b.service_name,
        sp.id as provider_id,
        sp.name as provider_name,
        sp.email as provider_email
      FROM provider_payouts pp
      JOIN service_providers sp ON pp.provider_id = sp.id
      LEFT JOIN bookings b ON pp.booking_id = b.id
      ORDER BY pp.created_at DESC
    `)

    // 3. Get summary statistics
    const [summary] = await connection.execute(`
      SELECT 
        COUNT(*) as total_payouts,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing_count,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_count,
        COALESCE(SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END), 0) as total_paid_amount,
        COALESCE(SUM(CASE WHEN status IN ('pending', 'processing') THEN amount ELSE 0 END), 0) as total_pending_amount
      FROM provider_payouts
    `)

    // Release connection
    connection.release()

    // Format the data
    const formattedProviders = providers.map(p => ({
      id: p.id,
      name: p.name,
      email: p.email,
      total_earnings: parseFloat(p.total_earnings),
      available_balance: parseFloat(p.available_balance),
      pending_balance: parseFloat(p.pending_balance),
      lifetime_balance: parseFloat(p.lifetime_balance),
      stripe_onboarding: p.stripe_onboarding_complete ? 'complete' : 'incomplete'
    }))

    const formattedPayouts = payouts.map(p => ({
      id: p.id,
      amount: parseFloat(p.amount),
      status: p.status,
      created_at: p.created_at,
      paid_at: p.paid_at,
      notes: p.notes,
      booking_id: p.booking_id,
      booking_number: p.booking_number,
      service_name: p.service_name,
      provider_id: p.provider_id,
      provider_name: p.provider_name,
      provider_email: p.provider_email,
      stripe_payout_id: p.stripe_payout_id,
      stripe_transfer_id: p.stripe_transfer_id
    }))

    const summaryData = summary[0] || {
      total_payouts: 0,
      pending_count: 0,
      processing_count: 0,
      paid_count: 0,
      failed_count: 0,
      total_paid_amount: 0,
      total_pending_amount: 0
    }

    return NextResponse.json({
      success: true,
      data: {
        summary: {
          total_payouts: summaryData.total_payouts,
          pending_count: summaryData.pending_count,
          processing_count: summaryData.processing_count,
          paid_count: summaryData.paid_count,
          failed_count: summaryData.failed_count,
          total_paid_amount: parseFloat(summaryData.total_paid_amount),
          total_pending_amount: parseFloat(summaryData.total_pending_amount)
        },
        providers: formattedProviders,
        payouts: formattedPayouts
      }
    })

  } catch (error) {
    console.error('Admin payouts error:', error)
    
    // Ensure connection is released even on error
    if (connection) connection.release()
    
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to load payouts' 
    }, { status: 500 })
  }
}