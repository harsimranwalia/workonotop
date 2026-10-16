// app/api/cron/crew-retention/route.js
// Once a day: erase what the job link keeps about cleaners who are gone, and trim what it keeps about those who are not (ENG-015, the first of the
// security conditions carried from ENG-014). What is kept, and for how long, is set out at the head of src/lib/crew-retention.js. The scheduler is
// the one in vercel.json, which sends CRON_SECRET as a Bearer token, as it does to auto-release.
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCronSecret } from '@/lib/api-auth'
import { runCrewRetention } from '@/lib/crew-retention'

export async function GET(request) {
  const secret = requireCronSecret(request)
  if (!secret.ok) return secret.response

  try {
    const summary = await runCrewRetention(execute)
    return NextResponse.json({ success: true, data: summary }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    // The error's code alone is logged: a driver's message can carry a value that was bound to the statement.
    console.error('Error trimming the crew data:', error?.code || error?.name)
    return NextResponse.json({ success: false, message: 'Failed to trim the crew data' }, { status: 500, headers: { 'Cache-Control': 'no-store' } })
  }
}
