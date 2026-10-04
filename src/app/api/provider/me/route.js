import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    // Ownership: the caller's own provider row, the id from the verified caller and nothing else.
    const providerId = caller.id;

    const providers = await execute(
      `SELECT id, name, email, phone, status, email_verified,
              onboarding_step, onboarding_completed, documents_verified,
              stripe_onboarding_complete, specialty, bio, experience_years,
              city, location, service_cities, skills, avatar_url,
              documents_uploaded, approved_at, created_at
       FROM service_providers 
       WHERE id = ?`,
      [providerId]
    );

    if (providers.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Provider not found' },
        { status: 404 }
      );
    }

    const provider = providers[0];

    // Fetch names for the saved service_cities IDs
    let service_cities_names = [];
    if (provider.service_cities) {
      try {
        const cityIds = typeof provider.service_cities === 'string' ? JSON.parse(provider.service_cities) : provider.service_cities;
        if (Array.isArray(cityIds) && cityIds.length > 0) {
          const placeholders = cityIds.map(() => '?').join(',');
          const citiesResult = await execute(`SELECT name FROM cities WHERE id IN (${placeholders})`, cityIds);
          service_cities_names = citiesResult.map(c => c.name);
        }
      } catch (e) {
        console.error('Failed to fetch service_cities_names:', e);
      }
    }
    provider.service_cities_names = service_cities_names;

    console.log('Provider data:', provider); // Debug log

    return NextResponse.json({
      success: true,
      provider: provider
    });

  } catch (error) {
    console.error('Auth check error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error' },
      { status: 500 }
    );
  }
}