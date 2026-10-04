// app/api/provider/jobs/route.js - FIXED with cookie auth
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  try {
    const providerId = auth.caller.id;

    const jobs = await execute(
      `SELECT 
        b.id,
        b.booking_number,
        b.service_name,
        b.job_date,
        b.job_time_slot,
        b.address_line1,
        b.city,
        b.status,
        b.created_at,
        b.accepted_at,
        b.start_time,
        b.end_time,
        b.actual_duration_minutes,
        b.overtime_minutes,
        b.overtime_earnings,
        b.provider_amount,
        b.final_provider_amount,
        b.service_price,
        b.additional_price,
        b.commission_percent,
        b.customer_first_name,
        b.customer_last_name,
        b.customer_email,
        b.customer_phone,
        b.job_description,
        b.instructions,
        b.parking_access,
        b.elevator_access,
        b.has_pets,
        b.job_timer_status,
        s.name as service_full_name,
        s.duration_minutes,
        c.name as category_name,
        sa.name as service_area_name, sa.cluster_group as service_area_group,
        (SELECT GROUP_CONCAT(photo_url) FROM booking_photos WHERE booking_id = b.id) as photos_csv
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      LEFT JOIN service_categories c ON s.category_id = c.id
      LEFT JOIN service_areas sa ON b.cluster = sa.cluster_key
      WHERE b.provider_id = ?
      ORDER BY 
        CASE b.status
          WHEN 'in_progress' THEN 1
          WHEN 'confirmed' THEN 2
          WHEN 'completed' THEN 3
          ELSE 4
        END,
        b.job_date DESC`,
      [providerId] // Note: using providerId, not id
    )

    // Parse and format data (same as before)
    for (const job of jobs) {
      if (job.job_time_slot) {
        job.job_time_slot = job.job_time_slot.split(',')
      }

      job.photos = job.photos_csv ? job.photos_csv.split(',') : []
      delete job.photos_csv
      
      job.service_price = parseFloat(job.service_price || 0)
      job.additional_price = parseFloat(job.additional_price || 0)
      job.provider_amount = parseFloat(job.provider_amount || 0)
      job.overtime_earnings = parseFloat(job.overtime_earnings || 0)
      job.final_provider_amount = job.final_provider_amount ? parseFloat(job.final_provider_amount) : null
      job.commission_percent = job.commission_percent ? parseFloat(job.commission_percent) : null
      
      job.overtime_rate = job.additional_price
      job.has_overtime = job.overtime_rate > 0
      job.duration_minutes = job.duration_minutes || 60
      
      if (job.status === 'completed' && job.final_provider_amount) {
        job.display_amount = job.final_provider_amount
      } else {
        job.display_amount = job.provider_amount
      }
    }

    return NextResponse.json({
      success: true,
      data: jobs
    })

  } catch (error) {
    console.error('Error fetching provider jobs:', error)
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to fetch jobs' 
    }, { status: 500 })
  }
}