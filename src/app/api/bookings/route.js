import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { requireCaller, callerFrom } from '@/lib/api-auth'
import { withConnection, execute, getConnection } from '@/lib/db'
import { notifyUser } from '@/lib/push'
import { sendEmail } from '@/lib/email'
import { getClusterFromCity } from '@/lib/location'
import { logActivity } from '@/lib/logger'
import { catalogPrice } from '@/lib/booking-price'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2026-05-27.dahlia' }) : null

function calcProviderAmount(servicePrice, commissionPct) {
  const price = parseFloat(servicePrice || 0)
  if (commissionPct == null || commissionPct === '') return price
  const pct = parseFloat(commissionPct)
  if (isNaN(pct)) return price
  const commissionAmount = price * (pct / 100)
  const result = price - commissionAmount
  return isNaN(result) ? price : parseFloat(result.toFixed(2))
}

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50')

    return await withConnection(async (connection) => {
      let sql = `
        SELECT b.*, s.name as service_name, s.slug as service_slug,
          s.image_url as service_image, s.duration_minutes as service_duration,
          c.name as category_name, sp.name as provider_name
        FROM bookings b
        LEFT JOIN services s ON b.service_id = s.id
        LEFT JOIN service_categories c ON s.category_id = c.id
        LEFT JOIN service_providers sp ON b.provider_id = sp.id
        WHERE EXISTS (SELECT 1 FROM users u WHERE u.email = b.customer_email)
      `
      const params = []
      if (email) { sql += ' AND b.customer_email = ?'; params.push(email) }
      if (status) { sql += ' AND b.status = ?'; params.push(status) }
      sql += ` ORDER BY b.created_at DESC LIMIT ${limit}`

      const [bookings] = await connection.execute(sql, params)

      let photosByBooking = {}
      if (bookings.length > 0) {
        const bookingIds = bookings.map(b => b.id)
        const placeholders = bookingIds.map(() => '?').join(',')
        const [allPhotos] = await connection.execute(
          `SELECT booking_id, photo_url FROM booking_photos WHERE booking_id IN (${placeholders})`,
          bookingIds
        )
        allPhotos.forEach(p => {
          if (!photosByBooking[p.booking_id]) photosByBooking[p.booking_id] = []
          photosByBooking[p.booking_id].push(p.photo_url)
        })
      }

      for (const booking of bookings) {
        if (booking.job_time_slot) booking.job_time_slot = booking.job_time_slot.split(',')
        booking.photos = photosByBooking[booking.id] || []
        booking.service_price = parseFloat(booking.service_price || 0)
        booking.additional_price = parseFloat(booking.additional_price || 0)
        booking.provider_amount = parseFloat(booking.provider_amount || 0)
        booking.overtime_earnings = parseFloat(booking.overtime_earnings || 0)
        booking.final_provider_amount = booking.final_provider_amount ? parseFloat(booking.final_provider_amount) : null
        booking.commission_percent = booking.commission_percent ? parseFloat(booking.commission_percent) : null
        booking.duration_minutes = booking.service_duration || 60
      }

      return NextResponse.json({ success: true, data: bookings })
    })
  } catch (error) {
    console.error('Error fetching bookings:', error)
    return NextResponse.json({ success: false, message: 'Failed to fetch bookings' }, { status: 500 })
  }
}

export async function POST(request) {
  let connection
  try {
    const body = await request.json()
    let {
      service_id, service_name,
      first_name, last_name, name, email, phone,
      job_date, job_time_slot, timing_constraints, job_description, instructions,
      parking_access, elevator_access, has_pets,
      address_line1, address_line2, city = '', postal_code, latitude, longitude,
      photos = [], user_id,
      payment_intent_id,
    } = body

    // --- Token-based User ID Override (Security & Stale State Protection) ---
    // This route stays public (guest checkout). A verified customer (cookie or Bearer, read by the shared
    // guard's normaliser) owns the booking they make: their id replaces any body user_id. With no customer
    // credential the body user_id is honoured as before, because the app's booking screen sends none (ENG-004 residual R1).
    let authenticatedUserId = user_id;
    const customer = await callerFrom(request, ['customer']);
    if (customer) {
      authenticatedUserId = Number(customer.id);
      console.log(`🛡️ [API Bookings] Overriding user_id ${user_id} with authenticated ID ${authenticatedUserId}`);
    }
    // ----------------------------------------------------------------------------

    // Fallback: If first/last name are missing but 'name' is provided (e.g. from mobile Google Auth)
    if ((!first_name || !last_name) && name) {
      const parts = name.trim().split(' ');
      if (!first_name) first_name = parts[0] || '';
      if (!last_name) last_name = parts.slice(1).join(' ') || '';
    }

    if (!service_id || !job_date || !job_time_slot || !address_line1 || !email) {
      return NextResponse.json({ success: false, message: 'Missing required fields (Service, Date, Time, Address, or Email)' }, { status: 400 })
    }

    if (!payment_intent_id) {
      return NextResponse.json(
        { success: false, message: 'Payment must be authorized before booking can be created.' },
        { status: 400 }
      )
    }

    const timeSlotString = (Array.isArray(job_time_slot) ? job_time_slot : [job_time_slot]).join(',')
    const bookingNumber = 'BK' + Date.now() + Math.floor(Math.random() * 1000)

    // Extract single valid primary date (YYYY-MM-DD) for MySQL DATE column
    let primaryJobDate = job_date;
    let allDatesString = '';

    if (Array.isArray(job_date)) {
      primaryJobDate = job_date[0];
      allDatesString = job_date.join(', ');
    } else if (typeof job_date === 'string' && job_date.includes(',')) {
      const parts = job_date.split(',').map(d => d.trim()).filter(Boolean);
      primaryJobDate = parts[0];
      allDatesString = parts.join(', ');
    }

    if (primaryJobDate && typeof primaryJobDate === 'string' && primaryJobDate.includes('T')) {
      primaryJobDate = primaryJobDate.split('T')[0];
    }

    let finalTimingConstraints = timing_constraints || '';
    if (allDatesString && !finalTimingConstraints.includes(allDatesString)) {
      finalTimingConstraints = finalTimingConstraints 
        ? `${finalTimingConstraints} (Selected Dates: ${allDatesString})` 
        : `Selected Dates: ${allDatesString}`;
    }

    // The booking records the catalog's price and hourly rate of its service, read here.
    const [serviceInfo] = await execute('SELECT duration_minutes, base_price, additional_price, is_active FROM services WHERE id = ?', [service_id])
    const catalog = catalogPrice(serviceInfo)
    if (!catalog) {
      return NextResponse.json({ success: false, message: 'This service is not available for booking' }, { status: 400 })
    }
    const standardDuration = serviceInfo.duration_minutes || 60

    const basePrice = catalog.price
    const overtimeRate = catalog.rate
    const maxOvertimeCost = overtimeRate * 2
    const totalAuthorizedAmount = basePrice + maxOvertimeCost

    let jobCluster = 'UNKNOWN_CLUSTER';
    if (city) {
      try {
        const areas = await execute('SELECT cluster_key, cities FROM service_areas WHERE is_active = 1');
        const searchCity = city.toLowerCase().trim();
        for (const area of areas) {
          const citiesArray = Array.isArray(area.cities) ? area.cities : [];
          if (citiesArray.some(c => c.toLowerCase().trim() === searchCity)) {
            jobCluster = area.cluster_key;
            break;
          }
        }
      } catch (err) {
        console.error('Error fetching dynamic cluster mapping', err);
        jobCluster = getClusterFromCity(city);
      }
    } else {
      jobCluster = getClusterFromCity(city);
    }

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    try {
      console.log('[API Bookings] Creating booking for:', email, bookingNumber);
      console.log('[API Bookings] Payload:', {
        service_id, first_name, last_name, email, phone, address_line1, job_description
      });

      const [result] = await connection.execute(
        `INSERT INTO bookings
         (booking_number, user_id, service_id, service_name, service_price, additional_price,
          customer_first_name, customer_last_name, customer_email, customer_phone,
          job_date, job_time_slot, timing_constraints, job_description, instructions,
          parking_access, elevator_access, has_pets,
          address_line1, address_line2, city, postal_code, latitude, longitude, cluster,
          commission_percent, provider_amount, status, job_timer_status, payment_status,
          standard_duration_minutes, payment_intent_id, authorized_amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,'pending','not_started','authorized',?,?,?)`,
        [
          bookingNumber, authenticatedUserId || null, service_id || null, service_name || null,
          basePrice, overtimeRate,
          first_name || '', last_name || '', email || '', phone || '',
          primaryJobDate || null, timeSlotString || null, finalTimingConstraints || null,
          job_description || '', instructions || null,
          parking_access ? 1 : 0, elevator_access ? 1 : 0, has_pets ? 1 : 0,
          address_line1 || '', address_line2 || null, city || '', postal_code || null,
          latitude || null, longitude || null, jobCluster,
          standardDuration || 60,
          payment_intent_id || null, totalAuthorizedAmount || 0,
        ]
      )

      const bookingId = result.insertId

      if (photos.length > 0) {
        await Promise.all(photos.map(photo => 
          connection.execute('INSERT INTO booking_photos (booking_id, photo_url) VALUES (?, ?)', [bookingId, photo])
        ));
      }

      await connection.execute(
        `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'pending', 'Booking created after payment authorization')`,
        [bookingId]
      )

      await connection.query('COMMIT')
      
      // Log Activity
      logActivity({
        actor_id: authenticatedUserId || null,
        actor_type: authenticatedUserId ? 'customer' : 'system',
        actor_name: `${first_name} ${last_name}`.trim() || 'Guest',
        action: 'BOOKING_CREATED',
        entity_type: 'booking',
        entity_id: bookingId,
        details: { service_name, amount: totalAuthorizedAmount }
      })

      if (authenticatedUserId) {
        notifyUser(authenticatedUserId, 'Booking Confirmed!', `Your booking #${bookingNumber} for ${service_name} has been created.`, { bookingId, bookingNumber, type: 'booking_created' }, execute, 'customer')
          .catch(err => console.error('[Push] Notification Error:', err));
      }

      // 🔔 Notify all admins (non-blocking)
      execute("SELECT id FROM users WHERE role = 'admin'").then(admins => {
        admins.forEach(admin => {
          notifyUser(admin.id, 'New Booking Created', `New booking #${bookingNumber} for ${service_name}`, { bookingId, type: 'booking_created' }, execute, 'admin')
            .catch(() => { });
        });
      }).catch(_ => { });

      // 🚀 BLAST LOGIC: Match Providers by Cluster and Service Type
      // Run completely in the background so it doesn't block the API response
      (async () => {
        try {
          let serviceSkills = [];
          if (service_id) {
            const serviceRows = await execute('SELECT skills FROM services WHERE id = ?', [service_id]);
            if (serviceRows.length > 0) {
              const rawSkills = serviceRows[0].skills;
              try { serviceSkills = typeof rawSkills === 'string' ? JSON.parse(rawSkills) : (rawSkills || []); } catch(e){}
            }
          }

          const providers = await execute(
            `SELECT id, phone, email, service_areas, skills FROM service_providers WHERE status = 'active'`
          );
          
          // Match providers
          const matchedProviders = providers.filter(p => {
            // Check if provider works in this cluster
            let areas = [];
            try { areas = typeof p.service_areas === 'string' ? JSON.parse(p.service_areas) : p.service_areas; } catch (e) {}
            if (!areas || !Array.isArray(areas) || !areas.includes(jobCluster)) return false;
            
            // Check if provider has matching skill
            let pSkills = [];
            try { pSkills = typeof p.skills === 'string' ? JSON.parse(p.skills) : p.skills; } catch (e) {}
            if (!pSkills || !Array.isArray(pSkills) || pSkills.length === 0) return false;
            
            if (serviceSkills && serviceSkills.length > 0) {
              // Intersection: provider must have at least one skill required by the service
              return pSkills.some(ps => serviceSkills.includes(ps));
            } else {
              // Fallback for services that don't have skills assigned yet
              const serviceNameLower = (service_name || '').toLowerCase();
              return pSkills.some(skill => serviceNameLower.includes(skill.toLowerCase()) || skill.toLowerCase().includes(serviceNameLower));
            }
          });

          console.log(`[API Bookings] Blasting to ${matchedProviders.length} providers for cluster ${jobCluster}`);
          
          const earningsAmount = (basePrice * 0.65).toFixed(2);
          const displayDate = new Date(job_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          
          matchedProviders.forEach(p => {
            // Send Push Notification
            notifyUser(p.id, 'New Job Available!', `Tap to view details for ${service_name} in ${city || jobCluster}`, { 
              bookingId, 
              type: 'job_blast',
              service_name,
              estimated_hours: standardDuration / 60,
              area: city || jobCluster,
              date_time: `${displayDate} • ${job_time_slot}`,
              earnings: earningsAmount
            }, execute, 'provider').catch(() => {});
            
            // TODO: WhatsApp Message Integration
            // if (p.phone) { sendWhatsApp(p.phone, messageText); }
          });
        } catch (err) {
          console.error('[API Bookings] Failed to blast providers in background:', err);
        }
      })();

      return NextResponse.json({
        success: true,
        booking_id: bookingId,
        booking_number: bookingNumber,
        overtime_rate: overtimeRate,
        standard_duration: standardDuration,
        authorized_amount: totalAuthorizedAmount,
        message: `✅ Booking confirmed. Card authorized for $${totalAuthorizedAmount}`
      })
    } catch (err) {
      await connection.query('ROLLBACK')
      throw err
    }
  } catch (error) {
    console.error('Error creating booking:', error)
    return NextResponse.json({ success: false, message: 'Failed to create booking: ' + error.message }, { status: 500 })
  } finally {
    if (connection) connection.release()
  }
}

export async function PUT(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  let connection;
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const body = await request.json();
    console.log(`[API PUT /api/bookings] ID: ${id}, Body:`, body);

    const { status, provider_id, notes, job_time_slot, commission_percent, payment_status } = body;

    // The guard above admits only an admin: the activity log names that admin, from the verified caller.
    const authenticatedUserId = Number(auth.caller.id);
    const actorType = 'admin';

    if (!id) return NextResponse.json({ success: false, message: 'Booking ID required' }, { status: 400 });

    connection = await getConnection();
    await connection.query('START TRANSACTION');

    try {
      const [[current]] = await connection.execute(
        'SELECT status, service_price, additional_price, commission_percent, provider_amount, provider_id as current_provider FROM bookings WHERE id = ?',
        [id]
      );

      if (!current) {
        console.error(`[API PUT] Booking NOT FOUND for ID: ${id}`);
        await connection.query('ROLLBACK');
        return NextResponse.json({ success: false, message: 'Booking not found' }, { status: 404 });
      }

      const updateFields = [];
      const updateParams = [];

      if (commission_percent !== undefined) {
        if (current.commission_percent !== null) {
          console.error(`[API PUT] Commission already set for ID: ${id}. Update rejected.`);
          await connection.query('ROLLBACK');
          return NextResponse.json({ success: false, message: 'Commission is already set and cannot be changed.' }, { status: 400 });
        }
        const providerAmt = calcProviderAmount(current.service_price, commission_percent);
        console.log(`[API PUT] Updating commission: ${commission_percent}%, Provider Amount: ${providerAmt}`);
        updateFields.push('commission_percent = ?', 'provider_amount = ?');
        updateParams.push(commission_percent, providerAmt);
      }

      if (status) {
        updateFields.push('status = ?');
        updateParams.push(status);
      }

      if ('provider_id' in body) {
        if (body.provider_id === null) {
          updateFields.push(
            'provider_id = NULL',
            'previous_provider_id = ?',
            'accepted_at = NULL',
            'start_time = NULL',
            'end_time = NULL',
            'job_timer_status = ?',
            'before_photos_uploaded = 0',
            'after_photos_uploaded = 0',
            'actual_duration_minutes = NULL',
            'overtime_minutes = 0',
            'overtime_earnings = 0',
            'final_provider_amount = NULL'
          );
          updateParams.push(current.current_provider || null, 'not_started');
          await connection.execute(`DELETE FROM job_photos WHERE booking_id = ?`, [id]);
          await connection.execute(`DELETE FROM booking_time_logs WHERE booking_id = ?`, [id]);
        } else {
          updateFields.push('provider_id = ?');
          updateParams.push(body.provider_id);
          if (!status) {
            updateFields.push('status = ?');
            updateParams.push('matching');
          }
        }
      }

      if (job_time_slot) {
        const slots = Array.isArray(job_time_slot) ? job_time_slot : [job_time_slot];
        updateFields.push('job_time_slot = ?');
        updateParams.push(slots.join(','));
      }

      if (payment_status) {
        updateFields.push('payment_status = ?');
        updateParams.push(payment_status);
      }

      if (updateFields.length > 0) {
        updateParams.push(id);
        const [updateRes] = await connection.execute(
          `UPDATE bookings SET ${updateFields.join(', ')}, updated_at = NOW() WHERE id = ?`,
          updateParams
        );
      }

      // History tracking
      // Use current.status if status is not provided, fallback to 'pending'
      const finalStatusForHistory = status || current.status || 'pending';

      if (status || 'provider_id' in body) {
        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, ?, ?)`,
          [id, status || (body.provider_id === null ? 'pending' : 'matching'), notes || `Status updated`]
        );
      }

      if (commission_percent !== undefined) {
        const providerAmt = calcProviderAmount(current.service_price, commission_percent);
        const commissionAmount = parseFloat(current.service_price || 0) * (parseFloat(commission_percent) / 100);
        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, ?, ?)`,
          [id, finalStatusForHistory,
            `Commission set to ${commission_percent}% (Admin: $${commissionAmount.toFixed(2)}, Provider: $${providerAmt.toFixed(2)})`]
        );
        logActivity({
          actor_id: authenticatedUserId, actor_type: actorType, actor_name: 'Admin',
          action: 'COMMISSION_UPDATED', entity_type: 'booking', entity_id: id,
          details: { commission_percent, providerAmt, commissionAmount }
        });
      }

      await connection.query('COMMIT');

      // Log assignment or status changes
      if (status) {
        logActivity({
          actor_id: authenticatedUserId, actor_type: actorType, actor_name: actorType.toUpperCase(),
          action: 'BOOKING_STATUS_CHANGED', entity_type: 'booking', entity_id: id,
          details: { status }
        });
      }
      if ('provider_id' in body && body.provider_id !== null) {
        logActivity({
          actor_id: authenticatedUserId, actor_type: actorType, actor_name: actorType.toUpperCase(),
          action: 'PROVIDER_ASSIGNED', entity_type: 'booking', entity_id: id,
          details: { provider_id: body.provider_id }
        });
      } else if ('provider_id' in body && body.provider_id === null) {
        logActivity({
          actor_id: authenticatedUserId, actor_type: actorType, actor_name: actorType.toUpperCase(),
          action: 'PROVIDER_REMOVED', entity_type: 'booking', entity_id: id,
          details: { previous_provider_id: current.current_provider }
        });
      }

      // Notifications (non-blocking)
      try {
        const [[bookingData]] = await connection.execute('SELECT user_id, booking_number, service_name FROM bookings WHERE id = ?', [id]);
        if (bookingData) {
          if (status && bookingData.user_id) {
            let title = 'Booking Update';
            let bodyMsg = `Your booking #${bookingData.booking_number} is now ${status.replace('_', ' ')}`;
            if (status === 'matching') { title = 'Provider Assigned'; bodyMsg = `A provider has been assigned to #${bookingData.booking_number}`; }
            else if (status === 'completed') { title = 'Service Completed'; bodyMsg = `Service #${bookingData.booking_number} has been completed.`; }
            notifyUser(bookingData.user_id, title, bodyMsg, { bookingId: id, status, type: 'status_update' }, execute, 'customer').catch(() => { });
          }
          if (provider_id && provider_id !== current.current_provider) {
            notifyUser(provider_id, 'New Job Assigned', `You have been assigned to #${bookingData.booking_number}`, { bookingId: id, type: 'new_job' }, execute, 'provider').catch(() => { });
          }
        }
      } catch (notifyErr) {
        console.error('[Push Error]', notifyErr);
      }

      return NextResponse.json({ success: true, message: 'Booking updated successfully' });
    } catch (err) {
      console.error('[API PUT Inner Error]', err);
      await connection.query('ROLLBACK');
      throw err;
    }
  } catch (error) {
    console.error('[API PUT Outer Error]', error);
    return NextResponse.json({ success: false, message: 'Failed to update booking: ' + error.message }, { status: 500 });
  } finally {
    if (connection) connection.release();
  }
}

export async function DELETE(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  let connection
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ success: false, message: 'ID required' }, { status: 400 })

    connection = await getConnection()
    await connection.beginTransaction()

    // Delete all related records to prevent orphans
    await connection.execute('DELETE FROM chat_messages WHERE booking_id = ?', [id])
    await connection.execute('DELETE FROM booking_photos WHERE booking_id = ?', [id])
    await connection.execute('DELETE FROM booking_status_history WHERE booking_id = ?', [id])
    await connection.execute('DELETE FROM booking_time_logs WHERE booking_id = ?', [id])
    await connection.execute('DELETE FROM job_photos WHERE booking_id = ?', [id])
    await connection.execute('DELETE FROM invoices WHERE booking_id = ?', [id])
    await connection.execute('DELETE FROM provider_reviews WHERE booking_id = ?', [id])
    await connection.execute('DELETE FROM provider_payouts WHERE booking_id = ?', [id]).catch(() => {}) // Catch in case table doesn't have booking_id

    // Finally delete the booking
    await connection.execute('DELETE FROM bookings WHERE id = ?', [id])
    
    await connection.commit()
    return NextResponse.json({ success: true, message: 'Booking and all related data deleted successfully' })
  } catch (error) {
    if (connection) await connection.rollback()
    console.error('Error deleting booking:', error)
    return NextResponse.json({ success: false, message: 'Failed to delete booking' }, { status: 500 })
  } finally {
    if (connection) connection.release()
  }
}