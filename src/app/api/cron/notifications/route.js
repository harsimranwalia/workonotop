import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { sendEmail } from '@/lib/email';
import { notifyUser } from '@/lib/push';
import { requireCronSecret } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const secret = requireCronSecret(request);
  if (!secret.ok) return secret.response;

  try {
    const results = { onboarding: 0, night_before: 0 };
    const now = new Date();

    // 1. Pro: Incomplete Profile Reminders
    // Stage 0 -> 1 hour
    // Stage 1 -> 24 hours
    // Stage 2 -> 72 hours
    const providers = await execute(`
      SELECT id, email, name, created_at, onboarding_reminder_stage 
      FROM service_providers 
      WHERE stripe_onboarding_complete = 0 
      AND onboarding_reminder_stage < 3
    `);

    for (const pro of providers) {
      const hoursSinceSignup = (now - new Date(pro.created_at)) / (1000 * 60 * 60);
      let targetStage = pro.onboarding_reminder_stage;

      if (targetStage === 0 && hoursSinceSignup >= 1) targetStage = 1;
      else if (targetStage === 1 && hoursSinceSignup >= 24) targetStage = 2;
      else if (targetStage === 2 && hoursSinceSignup >= 72) targetStage = 3;

      if (targetStage > pro.onboarding_reminder_stage) {
        // Send Push & Email
        const title = 'Complete Your Profile';
        const body = 'Your WorkOnTap profile is incomplete! Complete onboarding to start accepting jobs.';
        
        await sendEmail({
          to: pro.email,
          subject: title,
          text: `Hi ${pro.name}, ${body}`
        }).catch(console.error);

        await notifyUser(pro.id, 'provider', title, body, { type: 'onboarding_reminder' }).catch(console.error);

        await execute(
          'UPDATE service_providers SET onboarding_reminder_stage = ? WHERE id = ?',
          [targetStage, pro.id]
        );
        results.onboarding++;
      }
    }

    // 2. 7 PM Night Before Job (Pro & Client)
    // Runs hourly, so if current time is ~19:00 local time, and job_date is tomorrow
    // To be safe against timezone mismatches, let's just check if job_date is tomorrow
    // and current server hour is >= 19 (7 PM).
    const currentHour = now.getHours();
    
    // We send if it's 19:00 or later, and not yet sent.
    if (currentHour >= 19) {
      const tomorrowStr = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      const upcomingBookings = await execute(`
        SELECT b.id, b.user_id, b.provider_id, b.customer_email, b.customer_first_name, b.service_name, b.job_time_slot,
               sp.email as provider_email, sp.name as provider_name
        FROM bookings b
        LEFT JOIN service_providers sp ON b.provider_id = sp.id
        WHERE b.job_date = ? 
        AND b.status = 'confirmed' 
        AND b.night_before_reminder_sent = 0
      `, [tomorrowStr]);

      for (const booking of upcomingBookings) {
        const title = 'Upcoming Job Tomorrow';
        
        // Notify Client
        const clientBody = `Reminder: You have a ${booking.service_name} scheduled for tomorrow at ${booking.job_time_slot}.`;
        await sendEmail({
          to: booking.customer_email,
          subject: title,
          text: `Hi ${booking.customer_first_name},\n\n${clientBody}`
        }).catch(console.error);
        if (booking.user_id) {
          await notifyUser(booking.user_id, 'customer', title, clientBody, { booking_id: booking.id }).catch(console.error);
        }

        // Notify Pro
        if (booking.provider_id && booking.provider_email) {
          const proBody = `Reminder: You have a ${booking.service_name} job tomorrow at ${booking.job_time_slot}.`;
          await sendEmail({
            to: booking.provider_email,
            subject: title,
            text: `Hi ${booking.provider_name},\n\n${proBody}`
          }).catch(console.error);
          await notifyUser(booking.provider_id, 'provider', title, proBody, { booking_id: booking.id }).catch(console.error);
        }

        // Mark as sent
        await execute('UPDATE bookings SET night_before_reminder_sent = 1 WHERE id = ?', [booking.id]);
        results.night_before++;
      }
    }

    return NextResponse.json({ success: true, results });

  } catch (error) {
    console.error('Cron error:', error);
    return NextResponse.json({ success: false, message: 'Internal Server Error' }, { status: 500 });
  }
}
