import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';

/**
 * Unified current user endpoint.
 * Supports:
 * 1. Mobile (Authorization Bearer Header)
 * 2. Web (Cookies: customer_token, provider_token, adminAuth)
 */
export async function GET(request) {
  const auth = await requireCaller(request, ['customer', 'provider', 'admin']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller;
  try {
    // The profile is the caller's own, in the table of the caller's role (admins and customers are rows of users,
    // providers of service_providers; the two id spaces overlap, so the role decides).
    const userId = caller.id;
    const role = caller.role;

    let userData = null;

    if (role === 'provider') {
      // Lookup in service_providers table
      const providers = await query(
        `SELECT id, name, email, phone, status, specialty, bio, 
                experience_years, city, location, service_areas, skills,
                onboarding_step, onboarding_completed, documents_uploaded, email_verified, avatar_url,
                stripe_onboarding_complete, stripe_account_id
         FROM service_providers WHERE id = ?`,
        [userId]
      );
      if (providers.length > 0) {
        userData = providers[0];
        userData.id = Number(userData.id); // Ensure ID is a Number
        userData.role = 'provider';
        userData.email_verified = userData.email_verified || 0;
      }
    } else {
      // Lookup in users table (Customers and Admins)
      const users = await query(
        'SELECT id, email, first_name, last_name, phone, role, image_url FROM users WHERE id = ?',
        [userId]
      );
      if (users.length > 0) {
        userData = users[0];
        userData.id = Number(userData.id); // Ensure ID is a Number
        userData.status = 'active'; // Default status for users (not in DB)
        // Add fallbacks for fields missing in users table but expected by mobile app
        userData.onboarding_step = 1;
        userData.onboarding_completed = 1;
        userData.documents_uploaded = 0;
        
        // Ensure consistent role naming for frontend
        if (userData.role === 'user') userData.role = 'customer';
      }
    }

    if (!userData) {
      return NextResponse.json(
        { success: false, message: 'User profile not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      user: userData
    });

  } catch (error) {
    console.error('Unified Auth Me Error:', error);
    return NextResponse.json(
      { success: false, message: 'Session expired or invalid token' },
      { status: 401 }
    );
  }
}