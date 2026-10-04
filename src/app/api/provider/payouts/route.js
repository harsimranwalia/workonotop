import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    // A provider may name only themselves: a provider_id in the query that is not the caller's own id (compared as
    // strings) is a 403, never a 404. No parameter, or an empty one, means the caller's own money. The route still
    // reads only the caller's rows: every query below binds caller.id and nothing from the request.
    if (new URL(request.url).searchParams.getAll('provider_id').some((id) => id !== '' && id !== String(caller.id))) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 })
    }

    const providers = await execute(
      `SELECT 
        stripe_onboarding_complete,
        COALESCE(total_earnings, 0) as static_total_earnings,
        COALESCE(available_balance, 0) as static_available_balance,
        COALESCE(pending_balance, 0) as static_pending_balance,
        COALESCE(lifetime_balance, 0) as static_lifetime_balance
       FROM service_providers 
       WHERE id = ?`,
      [caller.id]
    )

    // Calculate balances dynamically from completed bookings
    const [bookingStats] = await execute(
      `SELECT 
        SUM(
          CASE 
            WHEN final_provider_amount > 0 THEN final_provider_amount
            ELSE (
              CASE 
                WHEN provider_amount > 0 THEN provider_amount
                WHEN service_price > 0 THEN service_price - (service_price * (COALESCE(commission_percent, 20) / 100))
                ELSE 0
              END
              + COALESCE(overtime_earnings, 0)
            )
          END
        ) as calculated_earnings
       FROM bookings 
       WHERE provider_id = ? AND status = 'completed'`,
      [caller.id]
    )

    const dynamicEarnings = parseFloat(bookingStats?.calculated_earnings || 0);

    // Get payout history
    const payouts = await execute(
      `SELECT amount, status, created_at
       FROM provider_payouts 
       WHERE provider_id = ? 
       ORDER BY created_at DESC`,
      [caller.id]
    )

    // Get recent completed jobs
    const recentJobs = await execute(
      `SELECT service_name, 
        CASE 
          WHEN final_provider_amount > 0 THEN final_provider_amount
          ELSE (
            CASE 
              WHEN provider_amount > 0 THEN provider_amount
              WHEN service_price > 0 THEN service_price - (service_price * (COALESCE(commission_percent, 20) / 100))
              ELSE 0
            END
            + COALESCE(overtime_earnings, 0)
          )
        END as amount,
        end_time
       FROM bookings 
       WHERE provider_id = ? AND status = 'completed'
       ORDER BY end_time DESC
       LIMIT 5`,
      [caller.id]
    )

    const provider = providers[0] || {}

    // Fully dynamic balances
    const totalPaid = payouts.filter(p => p.status === 'paid').reduce((sum, p) => sum + parseFloat(p.amount), 0)
    const totalPending = payouts.filter(p => ['pending', 'processing'].includes(p.status)).reduce((sum, p) => sum + parseFloat(p.amount), 0)
    
    const lifetimeBalance = dynamicEarnings
    const availableBalance = Math.max(0, lifetimeBalance - totalPaid - totalPending)

    return NextResponse.json({
      success: true,
      data: {
        provider: {
          stripe_onboarding: provider.stripe_onboarding_complete ? 'complete' : 'incomplete'
        },
        balances: {
          available_balance: availableBalance,
          pending_balance: totalPending,
          total_earnings: dynamicEarnings,
          lifetime_balance: lifetimeBalance
        },
        payouts: payouts.map(p => ({
          amount: parseFloat(p.amount),
          status: p.status,
          created_at: p.created_at
        })),
        recent_jobs: recentJobs.map(j => ({
          service_name: j.service_name,
          amount: parseFloat(j.amount || 0),
          end_time: j.end_time
        }))
      }
    })

  } catch (error) {
    console.error('Payouts error:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to load payouts' 
    }, { status: 500 })
  }
}