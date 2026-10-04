// // app/api/provider/profile/route.js
// import { NextResponse } from 'next/server'
// import { execute } from '@/lib/db'
// import { verifyToken } from '@/lib/jwt'  // ✅ same as your /api/provider/me

// // GET - Fetch full profile
// export async function GET(request) {
//   try {
//     const token = request.cookies.get('provider_token')?.value
//     if (!token) {
//       return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 })
//     }

//     const decoded = verifyToken(token)
//     if (!decoded || decoded.type !== 'provider') {
//       return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
//     }

//     const providers = await execute(
//       `SELECT 
//         id, name, email, phone,
//         specialty, experience_years,
//         rating, avg_rating, total_jobs, total_reviews,
//         bio, avatar_url, location, city,
//         status, service_areas, skills,
//         stripe_onboarding_complete,
//         onboarding_completed, onboarding_step,
//         DATE_FORMAT(created_at, '%Y-%m-%d') as join_date
//        FROM service_providers WHERE id = ?`,
//       [decoded.providerId]
//     )

//     if (!providers || providers.length === 0) {
//       return NextResponse.json({ success: false, message: 'Provider not found' }, { status: 404 })
//     }

//     const provider = { ...providers[0] }

//     // Safely parse JSON fields
//     provider.service_areas = (() => {
//       if (!provider.service_areas) return []
//       try { return typeof provider.service_areas === 'string' ? JSON.parse(provider.service_areas) : provider.service_areas }
//       catch { return [] }
//     })()

//     provider.skills = (() => {
//       if (!provider.skills) return []
//       try { return typeof provider.skills === 'string' ? JSON.parse(provider.skills) : provider.skills }
//       catch { return [] }
//     })()

//     return NextResponse.json({ success: true, data: provider })

//   } catch (error) {
//     console.error('Error fetching profile:', error)
//     return NextResponse.json({ success: false, message: 'Failed to fetch profile' }, { status: 500 })
//   }
// }

// // PUT - Update profile
// export async function PUT(request) {
//   try {
//     const token = request.cookies.get('provider_token')?.value
//     if (!token) {
//       return NextResponse.json({ success: false, message: 'Not authenticated' }, { status: 401 })
//     }

//     const decoded = verifyToken(token)
//     if (!decoded || decoded.type !== 'provider') {
//       return NextResponse.json({ success: false, message: 'Invalid token' }, { status: 401 })
//     }

//     const providerId = decoded.providerId

//     const body = await request.json()
//     const { name, email, phone, specialty, experience_years, bio, location, city, service_areas, skills } = body

//     if (!name?.trim()) return NextResponse.json({ success: false, message: 'Name is required' }, { status: 400 })
//     if (!email?.trim()) return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 })
//     if (!phone?.trim()) return NextResponse.json({ success: false, message: 'Phone is required' }, { status: 400 })

//     // Uniqueness checks
//     const existing = await execute('SELECT id FROM service_providers WHERE email = ? AND id != ?', [email.trim(), providerId])
//     if (existing.length > 0) return NextResponse.json({ success: false, message: 'Email already in use' }, { status: 400 })

//     const existingPhone = await execute('SELECT id FROM service_providers WHERE phone = ? AND id != ?', [phone.trim(), providerId])
//     if (existingPhone.length > 0) return NextResponse.json({ success: false, message: 'Phone already in use' }, { status: 400 })

//     // All params explicitly null-safe — never undefined
//     await execute(
//       `UPDATE service_providers SET
//         name=?, email=?, phone=?, specialty=?, experience_years=?,
//         bio=?, location=?, city=?, service_areas=?, skills=?, updated_at=NOW()
//        WHERE id=?`,
//       [
//         name.trim(),
//         email.trim(),
//         phone.trim(),
//         specialty?.trim() || null,
//         (experience_years !== undefined && experience_years !== '' && experience_years !== null) ? parseInt(experience_years) : null,
//         bio?.trim() || null,
//         location?.trim() || null,
//         city?.trim() || null,
//         Array.isArray(service_areas) ? JSON.stringify(service_areas) : null,
//         Array.isArray(skills) ? JSON.stringify(skills) : null,
//         providerId
//       ]
//     )

//     // Return updated data
//     const updated = await execute(
//       `SELECT id, name, email, phone, specialty, experience_years,
//               rating, avg_rating, total_jobs, total_reviews,
//               bio, avatar_url, location, city, status, service_areas, skills,
//               DATE_FORMAT(created_at, '%Y-%m-%d') as join_date
//        FROM service_providers WHERE id = ?`,
//       [providerId]
//     )

//     const provider = { ...updated[0] }
//     provider.service_areas = (() => { try { return typeof provider.service_areas === 'string' ? JSON.parse(provider.service_areas) : (provider.service_areas || []) } catch { return [] } })()
//     provider.skills = (() => { try { return typeof provider.skills === 'string' ? JSON.parse(provider.skills) : (provider.skills || []) } catch { return [] } })()

//     return NextResponse.json({ success: true, message: 'Profile updated successfully', data: provider })

//   } catch (error) {
//     console.error('Error updating profile:', error)
//     return NextResponse.json({ success: false, message: 'Failed to update profile' }, { status: 500 })
//   }
// }










// app/api/provider/profile/route.js
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { logActivity } from '@/lib/logger'

// GET - Fetch full profile
export async function GET(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    // Ownership: the caller's own provider row (and its documents), the id from the verified caller and nothing else.
    const providerId = caller.id

    // Get provider details from service_providers
    const providers = await execute(
      `SELECT 
        sp.id, sp.name, sp.email, sp.phone,
        sp.specialty, sp.experience_years,
        sp.rating, sp.avg_rating, sp.total_jobs, sp.total_reviews,
        sp.bio, sp.location, sp.city,
        sp.avatar_url,
        sp.status, sp.service_cities, sp.skills,
        sp.stripe_onboarding_complete,
        sp.onboarding_completed, sp.onboarding_step,
        sp.documents_verified, sp.documents_uploaded,
        DATE_FORMAT(sp.created_at, '%Y-%m-%d') as join_date
       FROM service_providers sp WHERE sp.id = ?`,
      [providerId]
    )

    if (!providers || providers.length === 0) {
      return NextResponse.json({ success: false, message: 'Provider not found' }, { status: 404 })
    }

    const provider = { ...providers[0] }

    // If avatar_url is NULL in service_providers, try to get from provider_documents
    if (!provider.avatar_url) {
      try {
        const documents = await execute(
          `SELECT document_url FROM provider_documents 
           WHERE provider_id = ? AND document_type = 'profile_photo' AND status = 'approved'
           ORDER BY created_at DESC LIMIT 1`,
          [providerId]
        )

        if (documents && documents.length > 0 && documents[0].document_url) {
          provider.avatar_url = documents[0].document_url;
        }
      } catch (docError) {
        console.error('Error fetching profile photo from documents:', docError);
        // Continue without avatar
      }
    }

    // Also fetch all documents for reference
    try {
      const allDocs = await execute(
        `SELECT id, document_type, document_url, status, 
                DATE_FORMAT(created_at, '%Y-%m-%d %H:%i:%s') as uploaded_at,
                verified_at, rejection_reason
         FROM provider_documents 
         WHERE provider_id = ?
         ORDER BY created_at DESC`,
        [providerId]
      )
      provider.documents = allDocs || [];
    } catch (docError) {
      console.error('Error fetching all documents:', docError);
      provider.documents = [];
    }

    // Safely parse JSON fields
    provider.service_cities = (() => {
      if (!provider.service_cities) return []
      try {
        return typeof provider.service_cities === 'string'
          ? JSON.parse(provider.service_cities)
          : (provider.service_cities || [])
      } catch {
        return []
      }
    })()

    provider.skills = (() => {
      if (!provider.skills) return []
      try {
        return typeof provider.skills === 'string'
          ? JSON.parse(provider.skills)
          : (provider.skills || [])
      } catch {
        return []
      }
    })()

    // Fetch names for the saved service_cities IDs
    let service_cities_names = [];
    if (provider.service_cities && provider.service_cities.length > 0) {
      try {
        const placeholders = provider.service_cities.map(() => '?').join(',');
        const citiesResult = await execute(`SELECT name FROM cities WHERE id IN (${placeholders})`, provider.service_cities);
        service_cities_names = citiesResult.map(c => c.name);
      } catch (e) {
        console.error('Failed to fetch service_cities_names:', e);
      }
    }
    provider.service_cities_names = service_cities_names;

    return NextResponse.json({ success: true, data: provider })

  } catch (error) {
    console.error('Error fetching profile:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch profile' }, { status: 500 })
  }
}

// PUT - Update profile
export async function PUT(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const caller = auth.caller
  try {
    // Ownership: the UPDATE and the uniqueness checks below bind providerId, which is caller.id; an id, provider_id
    // or email in the body or query is never read as the row to write.
    const providerId = caller.id

    const body = await request.json()
    const { name, email, phone, specialty, experience_years, bio, location, city, service_cities, skills } = body

    if (!name?.trim()) return NextResponse.json({ success: false, message: 'Name is required' }, { status: 400 })
    if (!email?.trim()) return NextResponse.json({ success: false, message: 'Email is required' }, { status: 400 })
    if (!phone?.trim()) return NextResponse.json({ success: false, message: 'Phone is required' }, { status: 400 })

    // Uniqueness checks
    const existing = await execute('SELECT id FROM service_providers WHERE email = ? AND id != ?', [email.trim(), providerId])
    if (existing.length > 0) return NextResponse.json({ success: false, message: 'Email already in use' }, { status: 400 })

    const existingPhone = await execute('SELECT id FROM service_providers WHERE phone = ? AND id != ?', [phone.trim(), providerId])
    if (existingPhone.length > 0) return NextResponse.json({ success: false, message: 'Phone already in use' }, { status: 400 })

    // Update provider details
    await execute(
      `UPDATE service_providers SET
        name=?, email=?, phone=?, specialty=?, experience_years=?,
        bio=?, location=?, city=?, service_cities=?, skills=?, updated_at=NOW()
       WHERE id=?`,
      [
        name.trim(),
        email.trim(),
        phone.trim(),
        specialty?.trim() || null,
        (experience_years !== undefined && experience_years !== '' && experience_years !== null) ? parseInt(experience_years) : null,
        bio?.trim() || null,
        location?.trim() || null,
        city?.trim() || null,
        Array.isArray(service_cities) ? JSON.stringify(service_cities) : null,
        Array.isArray(skills) ? JSON.stringify(skills) : null,
        providerId
      ]
    )

    // Log Activity
    logActivity({
      actor_id: providerId,
      actor_type: 'provider',
      actor_name: name.trim(),
      action: 'PROVIDER_PROFILE_UPDATED',
      entity_type: 'provider',
      entity_id: providerId,
      details: { email: email.trim(), phone: phone.trim() }
    })

    // Return updated data
    const updated = await execute(
      `SELECT id, name, email, phone, specialty, experience_years,
              rating, avg_rating, total_jobs, total_reviews,
              bio, avatar_url, location, city, status, service_cities, skills,
              documents_verified, documents_uploaded,
              DATE_FORMAT(created_at, '%Y-%m-%d') as join_date
       FROM service_providers WHERE id = ?`,
      [providerId]
    )

    const provider = { ...updated[0] }

    // Try to get avatar from documents if not in service_providers
    if (!provider.avatar_url) {
      try {
        const documents = await execute(
          `SELECT document_url FROM provider_documents 
           WHERE provider_id = ? AND document_type = 'profile_photo' AND status = 'approved'
           ORDER BY created_at DESC LIMIT 1`,
          [providerId]
        )

        if (documents && documents.length > 0 && documents[0].document_url) {
          provider.avatar_url = documents[0].document_url;
        }
      } catch (docError) {
        console.error('Error fetching profile photo:', docError);
      }
    }

    // Parse JSON fields
    provider.service_cities = (() => {
      try {
        return typeof provider.service_cities === 'string'
          ? JSON.parse(provider.service_cities)
          : (provider.service_cities || [])
      } catch {
        return []
      }
    })()

    provider.skills = (() => {
      try {
        return typeof provider.skills === 'string'
          ? JSON.parse(provider.skills)
          : (provider.skills || [])
      } catch {
        return []
      }
    })()

    return NextResponse.json({ success: true, message: 'Profile updated successfully', data: provider })

  } catch (error) {
    console.error('Error updating profile:', error)
    return NextResponse.json({ success: false, message: 'Failed to update profile' }, { status: 500 })
  }
}