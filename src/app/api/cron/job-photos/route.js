// app/api/cron/job-photos/route.js
// Once a day: delete the photos taken at the job link once the time in which a dispute can come has passed, and the files that no row names (ENG-016,
// ADR-013). What is kept, and for how long, is set out at the head of src/lib/job-photo-retention.js. The scheduler is the one in vercel.json, which
// sends CRON_SECRET as a Bearer token, as it does to auto-release and crew-retention.
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCronSecret } from '@/lib/api-auth'
import { runJobPhotoRetention } from '@/lib/job-photo-retention'

export async function GET(request) {
  const secret = requireCronSecret(request)
  if (!secret.ok) return secret.response

  try {
    const summary = await runJobPhotoRetention(execute)
    return NextResponse.json({ success: true, data: summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement.
    console.error('Error trimming the job photos:', error?.code || error?.name)
    return NextResponse.json({ success: false, message: 'Failed to trim the job photos' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
