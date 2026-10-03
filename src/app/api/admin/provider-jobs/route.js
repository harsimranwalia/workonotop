import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';  // ← Bas yahi chahiye
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const providerId = searchParams.get('providerId');

    if (!providerId) {
      return NextResponse.json({ success: false, message: 'Provider ID is required' }, { status: 400 });
    }

    const providerCheck = await execute('SELECT * FROM service_providers WHERE id = ?', [providerId]);

    if (providerCheck.length === 0) {
      return NextResponse.json({ success: false, message: 'Provider not found' }, { status: 404 });
    }

    const jobs = await execute(`
      SELECT b.*, s.name AS service_name
      FROM bookings b
      LEFT JOIN services s ON b.service_id = s.id
      WHERE b.provider_id = ?
      ORDER BY b.created_at DESC
    `, [providerId]);

    // attach photos (if any)
    let jobsWithPhotos = jobs.map(job => ({ ...job, photos: [] }));

    if (jobs.length > 0) {
      const jobIds = jobs.map(j => j.id);
      const placeholders = jobIds.map(() => '?').join(',');
      const allPhotos = await execute(
        `SELECT photo_url, photo_type, booking_id FROM job_photos WHERE booking_id IN (${placeholders})`,
        jobIds
      );

      const photosByJob = {};
      allPhotos.forEach(p => {
        if (!photosByJob[p.booking_id]) photosByJob[p.booking_id] = [];
        photosByJob[p.booking_id].push(p);
      });

      jobsWithPhotos = jobs.map(job => ({ ...job, photos: photosByJob[job.id] || [] }));
    }

    const stats = calculateProviderStats(jobsWithPhotos, providerCheck[0]);

    return NextResponse.json({
      success: true,
      data: jobsWithPhotos,
      recentJobs: jobsWithPhotos.slice(0, 5),
      provider: providerCheck[0],
      stats,
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json({ success: false, message: 'Failed' }, { status: 500 });
  }
  // ← finally/release ki zarurat nahi! execute() pool automatically handle karta hai
}

// helper copied from UI page so stats work on server
function calculateProviderStats(jobs, provider) {
  const completed = jobs.filter(j => j.status === 'completed');
  const pending = jobs.filter(j => ['pending', 'matching', 'confirmed'].includes(j.status));
  const cancelled = jobs.filter(j => j.status === 'cancelled');
  const totalEarnings = completed.reduce((sum, job) => sum + parseFloat(job.final_provider_amount || job.provider_amount || 0), 0);
  const totalMinutes = completed.reduce((sum, job) => sum + (parseInt(job.actual_duration_minutes) || 0), 0);
  const serviceCount = {};
  jobs.forEach(job => { serviceCount[job.service_name] = (serviceCount[job.service_name] || 0) + 1 });
  const topServices = Object.entries(serviceCount).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count).slice(0, 5);
  const monthlyEarnings = [];
  const now = new Date();
  for (let i = 5; i >= 0; i--) {
    const month = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthName = month.toLocaleString('default', { month: 'short' });
    const monthEarnings = completed
      .filter(job => {
        const d = new Date(job.end_time || job.created_at);
        return d.getMonth() === month.getMonth() && d.getFullYear() === month.getFullYear();
      })
      .reduce((sum, job) => sum + parseFloat(job.final_provider_amount || job.provider_amount || 0), 0);
    monthlyEarnings.push({ month: monthName, earnings: monthEarnings });
  }
  return {
    totalJobs: jobs.length, completedJobs: completed.length,
    pendingJobs: pending.length, cancelledJobs: cancelled.length,
    totalEarnings, avgRating: parseFloat(provider.rating) || 0,
    totalHoursWorked: Math.round((totalMinutes / 60) * 10) / 10,
    completionRate: jobs.length ? Math.round((completed.length / jobs.length) * 100) : 0,
    topServices, monthlyEarnings
  };
}