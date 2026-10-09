import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  try {
    // The provider is the caller: every query below reads only their own id
    const providerId = auth.caller.id;

    // Get job stats
    const jobStats = await execute(
      `SELECT 
        COUNT(*) as totalJobs,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
        SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressJobs,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END) as confirmedJobs,
        SUM(
          CASE 
            WHEN status = 'completed' AND final_provider_amount > 0 THEN final_provider_amount
            WHEN provider_amount > 0 THEN provider_amount
            WHEN service_price > 0 THEN service_price - (service_price * (COALESCE(commission_percent, 20) / 100))
            ELSE 0
          END
        ) as totalEarnings
       FROM bookings 
       WHERE provider_id = ?`,
      [providerId]
    );

    // Get average rating
    const ratingStats = await execute(
      `SELECT AVG(rating) as avgRating 
       FROM provider_reviews 
       WHERE provider_id = ?`,
      [providerId]
    );

    // Get recent jobs
    const recentJobs = await execute(
      `SELECT id, service_name, job_date, status, provider_amount
       FROM bookings 
       WHERE provider_id = ? 
       ORDER BY created_at DESC 
       LIMIT 5`,
      [providerId]
    );

    return NextResponse.json({
      success: true,
      stats: {
        totalJobs: parseInt(jobStats[0]?.totalJobs || 0),
        completedJobs: parseInt(jobStats[0]?.completedJobs || 0),
        inProgressJobs: parseInt(jobStats[0]?.inProgressJobs || 0),
        confirmedJobs: parseInt(jobStats[0]?.confirmedJobs || 0),
        totalEarnings: parseFloat(jobStats[0]?.totalEarnings || 0),
        averageRating: parseFloat(ratingStats[0]?.avgRating || 0),
        recentJobs: recentJobs || []
      }
    });

  } catch (error) {
    console.error('Dashboard stats error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}