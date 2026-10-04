// app/api/provider/jobs/[id]/route.js - FIXED with cookie auth
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params

    // Get job with photo status
    const jobs = await execute(
      `SELECT 
        b.*,
        s.name as service_full_name,
        s.duration_minutes,
        s.skills as required_skills,
        c.name as category_name,
        d.reason as dispute_reason,
        (SELECT COUNT(*) FROM job_photos WHERE booking_id = b.id AND photo_type = 'before') > 0 as has_before_photos,
        (SELECT COUNT(*) FROM job_photos WHERE booking_id = b.id AND photo_type = 'after') > 0 as has_after_photos
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN service_categories c ON s.category_id = c.id
      LEFT JOIN disputes d ON b.id = d.booking_id
      WHERE b.id = ? AND (b.provider_id = ? OR (b.provider_id IS NULL AND b.status IN ('pending', 'matching')))`,
      [id, auth.caller.id]  // the caller's own jobs; a job that is not theirs (or open) stays this route's 404
    )

    if (jobs.length === 0) {
      return NextResponse.json({ 
        success: false, 
        message: 'Job not found' 
      }, { status: 404 })
    }

    // Helper to get system settings
    async function getSystemSetting(key, defaultValue = null) {
      try {
        const results = await execute('SELECT `value` FROM system_settings WHERE `key` = ?', [key])
        return results && results.length > 0 ? results[0].value : defaultValue
      } catch (error) {
        return defaultValue
      }
    }

    const defaultCommRaw = await getSystemSetting('default_commission', '20')
    const defaultComm = parseFloat(defaultCommRaw)

    const job = jobs[0]
    
    // Fetch customer-provided photos
    const photos = await execute(
      'SELECT photo_url FROM booking_photos WHERE booking_id = ?',
      [id]
    )
    job.photos = photos.map(p => p.photo_url)

    // Parse time slots
    if (job.job_time_slot) {
      job.job_time_slot = job.job_time_slot.split(',')
    }

    // Pricing Calculation Logic (matches available-jobs)
    const commPct = job.commission_percent !== null ? parseFloat(job.commission_percent) : defaultComm
    const basePrice = parseFloat(job.service_price || 0)
    const otRate = parseFloat(job.additional_price || 0)
    const providerAmount = job.commission_percent !== null ? parseFloat(job.provider_amount || 0) : 0
    const duration = job.duration_minutes || 60
    const commAmt = basePrice * (commPct / 100)
    const baseEarnings = basePrice - commAmt
    const netOT = otRate * (1 - commPct / 100)

    job.pricing = {
      is_approved: true,
      base_price: basePrice,
      commission_percent: commPct,
      commission_amount: commAmt,
      provider_base_earnings: baseEarnings,
      has_overtime: otRate > 0,
      overtime_rate: otRate,
      net_overtime_rate: netOT,
      total_provider_amount: providerAmount || baseEarnings,
      duration_minutes: duration,
    }

    job.display_amount = `$${(providerAmount || baseEarnings).toFixed(2)}`

    // Ensure numeric values for legacy compatibility
    job.service_price = basePrice
    job.additional_price = otRate
    job.provider_amount = providerAmount
    job.commission_percent = commPct
    job.duration_minutes = duration

    return NextResponse.json({
      success: true,
      data: job
    })

  } catch (error) {
    console.error('Error fetching job:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to fetch job' 
    }, { status: 500 })
  }
}