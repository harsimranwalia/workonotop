import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';
import { NextResponse } from 'next/server';

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id;
  try {
    const body = await request.json();
    const { bio, specialty, experience_years, city, location, service_cities, skills } = body;

    // server-side validation
    if (!bio || typeof bio !== 'string' || !bio.trim()) {
      return NextResponse.json({ success: false, message: 'Bio is required' }, { status: 400 });
    }
    const trimmed = bio.trim();
    if (trimmed.length < 10) {
      return NextResponse.json({ success: false, message: 'Bio must be at least 10 characters' }, { status: 400 });
    }
    if (trimmed.length > 500) {
      return NextResponse.json({ success: false, message: 'Bio cannot exceed 500 characters' }, { status: 400 });
    }

    await execute(
      `UPDATE service_providers 
       SET bio = ?, specialty = ?, experience_years = ?,
           city = ?, location = ?, service_cities = ?,
           skills = ?, onboarding_step = 2
       WHERE id = ?`,
      [
        bio,
        specialty,
        experience_years,
        city,
        location,
        JSON.stringify(service_cities || []),
        JSON.stringify(skills || []),
        providerId
      ]
    );

    return NextResponse.json({
      success: true,
      message: 'Profile updated successfully'
    });

  } catch (error) {
    console.error('Profile update error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}