import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id;
  try {
    const body = await request.json();
    const { step } = body;

    if (!step) {
      return NextResponse.json(
        { success: false, message: 'Step is required' },
        { status: 400 }
      );
    }

    // Update the provider's current onboarding step
    await execute(
      `UPDATE service_providers 
       SET 
           onboarding_step = ?,
           updated_at = NOW()
       WHERE id = ?`,
      [step, providerId]
    );

    return NextResponse.json({
      success: true,
      message: 'Onboarding step updated successfully',
      step: step
    });

  } catch (error) {
    console.error('Error updating onboarding step:', error);
    return NextResponse.json(
      { success: false, message: 'Server error: ' + error.message },
      { status: 500 }
    );
  }
}
