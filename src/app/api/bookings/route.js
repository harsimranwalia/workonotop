import Stripe from 'stripe'
import { NextResponse } from 'next/server'
import { requireCaller, callerFrom } from '@/lib/api-auth'
import { withConnection, execute, getConnection } from '@/lib/db'
import { notifyUser } from '@/lib/push'
import { sendEmail } from '@/lib/email'
import { getClusterFromCity } from '@/lib/location'
import { logActivity } from '@/lib/logger'
import { queueStateOf } from '@/lib/marketplace'
import { catalogPrice } from '@/lib/booking-price'
import { loadPricing, priceJob, priceVisits, refusalOf } from '@/lib/pricing-rules'
import { paymentAmountCents, paymentCheckMode, checkHeldPayment } from '@/lib/booking-payment'
import { FREQUENCIES, visitSlot } from '@/lib/visit-series'
import { clearBookingCrew } from '@/lib/booking-crew'

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

// The job queue (?queue=1) is read a page at a time: QUEUE_DEFAULT_LIMIT bookings when the call names no size, never more than QUEUE_MAX_LIMIT.
const QUEUE_DEFAULT_LIMIT = 200
const QUEUE_MAX_LIMIT = 500

// A whole number from a query parameter, held to min..max; a missing or non-numeric value is the fallback.
function pageNumber(raw, fallback, min, max) {
  const n = parseInt(raw, 10)
  return Number.isNaN(n) ? fallback : Math.min(Math.max(n, min), max)
}

// A request for repeating visits that is refused: one line naming the booking number and the check that refused, then the answer.
function seriesRefusal(bookingNumber, check, answer, status) {
  console.log(`[API Bookings] ${bookingNumber}: repeating visits refused at check '${check}'`)
  return NextResponse.json(answer, { status })
}

// The message of a booked series: how many visits it holds, then what was done with the first visit's payment.
function seriesMessage(count, paymentStatus, authorizedAmount) {
  if (paymentStatus === 'authorized') {
    return `Booking confirmed: ${count} visits. Your card is held for $${authorizedAmount.toFixed(2)} for the first visit. Each visit is charged to this card when it is done.`
  }
  if (paymentStatus === 'paid') {
    return `Booking confirmed: ${count} visits. Payment of $${authorizedAmount.toFixed(2)} received for the first visit. Each later visit is charged to this card when it is done.`
  }
  return `Booking confirmed: ${count} visits. Payment was not verified: payments are not configured on this server.`
}

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url)
    const email = searchParams.get('email')
    const status = searchParams.get('status')
    const limit = parseInt(searchParams.get('limit') || '50')
    const queue = searchParams.get('queue') === '1'
    const queueLimit = pageNumber(searchParams.get('limit'), QUEUE_DEFAULT_LIMIT, 1, QUEUE_MAX_LIMIT)
    const queueOffset = pageNumber(searchParams.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER)

    return await withConnection(async (connection) => {
      // The admin job queue: every booking waiting for a provider, on the marketplace, or assigned and not yet accepted, guest bookings included, oldest first, one page at a time.
      // The answer carries total (the whole queue) and the limit and offset it used, so a client pages by what was applied.
      const where = queue
        ? `b.status NOT IN ('completed', 'cancelled') AND (b.provider_id IS NULL OR b.status IN ('pending', 'matching'))`
        : `EXISTS (SELECT 1 FROM users u WHERE u.email = b.customer_email)`
      // The standard duration is the booking's quoted minutes.
      let sql = `
        SELECT b.*, s.name as service_name, s.slug as service_slug,
          s.image_url as service_image, COALESCE(b.standard_duration_minutes, s.duration_minutes, 60) as service_duration,
          c.name as category_name, sp.name as provider_name
        FROM bookings b
        LEFT JOIN services s ON b.service_id = s.id
        LEFT JOIN service_categories c ON s.category_id = c.id
        LEFT JOIN service_providers sp ON b.provider_id = sp.id
        WHERE ${where}
      `
      const params = []
      if (!queue && email) { sql += ' AND b.customer_email = ?'; params.push(email) }
      if (!queue && status) { sql += ' AND b.status = ?'; params.push(status) }
      sql += queue ? ` ORDER BY b.created_at ASC, b.id ASC LIMIT ${queueLimit} OFFSET ${queueOffset}` : ` ORDER BY b.created_at DESC LIMIT ${limit}`

      const [bookings] = await connection.execute(sql, params)

      let total
      if (queue) {
        const [counted] = await connection.execute(`SELECT COUNT(*) AS total FROM bookings b WHERE ${where}`)
        total = Number(counted[0].total)
      }

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
        booking.queue_state = queueStateOf(booking)
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

      return NextResponse.json(queue
        ? { success: true, data: bookings, total, limit: queueLimit, offset: queueOffset }
        : { success: true, data: bookings })
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

    if (!payment_intent_id || typeof payment_intent_id !== 'string'
        || payment_intent_id.length > 255 || !/^pi_[A-Za-z0-9_-]+$/.test(payment_intent_id)) {
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

    // Repeating visits: the frequency comes inside the answers, and its absence is a one-time booking. A series is booked by a
    // signed-in customer, from one start date and the times of that date; the server works out every visit's date from them.
    const frequency = body.answers?.frequency
    const series = frequency != null
    if (series) {
      if (!Object.keys(FREQUENCIES).includes(frequency)) {
        return seriesRefusal(bookingNumber, 'frequency', refusalOf({ ok: false, reason: 'answers', field: 'frequency' }), 400)
      }
      if (!customer) {
        return seriesRefusal(bookingNumber, 'sign_in', { success: false, message: 'Please sign in to book repeating visits.' }, 401)
      }
      // The dates counted as they are read above: an array, a comma list, or one date.
      const dateCount = Array.isArray(job_date) ? job_date.length : String(job_date).split(',').map(d => d.trim()).filter(Boolean).length
      if (dateCount !== 1) {
        return seriesRefusal(bookingNumber, 'job_date', { success: false, message: 'Choose one start date for repeating visits.', field: 'job_date' }, 400)
      }
      // The times are stored as one comma list, one entry per date.
      if (!timeSlotString || timeSlotString.includes(',')) {
        return seriesRefusal(bookingNumber, 'job_time_slot', { success: false, message: 'Choose the times for the start date only.', field: 'job_time_slot' }, 400)
      }
    }

    // The booking records the price and the quoted minutes the service's pricing rule gives for its answers, worked out here. The job's first date decides the weekend.
    const { service: serviceInfo, items: pricingItems, discounts } = await loadPricing(execute, service_id)
    // With answers, the rule is given the booking's own first date (the one stored in job_date) in place of any date the answers hold; with none, no date is read.
    const answers = body.answers
    const isAnswersObject = typeof answers === 'object' && answers !== null && !Array.isArray(answers)
    const hasAnswers = answers !== undefined && answers !== null && !(isAnswersObject && Object.keys(answers).length === 0)
    const ruleAnswers = hasAnswers && isAnswersObject ? { ...answers, date: primaryJobDate } : answers
    const job = priceJob(serviceInfo, pricingItems, ruleAnswers, discounts)
    if (!job.ok) {
      // The date the rule refuses is the booking's first date, which this route calls job_date.
      const refusal = refusalOf(job)
      return NextResponse.json(job.field === 'date' ? { ...refusal, field: 'job_date' } : refusal, { status: 400 })
    }
    const catalog = catalogPrice(serviceInfo)
    const standardDuration = job.minutes

    const basePrice = job.price
    const overtimeRate = catalog.rate
    const bounds = paymentAmountCents(basePrice)
    if (!bounds.ok) {
      return NextResponse.json({
        success: false,
        message: bounds.reason === 'below_minimum'
          ? 'The price for these answers is below the smallest amount a card payment can take'
          : 'The price for these answers is larger than a card payment can take',
        field: 'answers',
      }, { status: 400 })
    }

    // Every visit of a series is priced by the rule for its own date, the frequency's discount included, and is charged that price
    // when it is done, so each visit's price must be one a card payment can take. The first visit is the job priced above.
    let visits = []
    if (series) {
      const priced = priceVisits(serviceInfo, pricingItems, ruleAnswers, discounts)
      if (!priced.ok) {
        const refusal = refusalOf(priced)
        return seriesRefusal(bookingNumber, 'visit_price', priced.field === 'date' ? { ...refusal, field: 'job_date' } : refusal, 400)
      }
      const outside = priced.visits.map((visit) => paymentAmountCents(visit.price)).find((visitBounds) => !visitBounds.ok)
      if (outside) {
        return seriesRefusal(bookingNumber, 'visit_amount', {
          success: false,
          message: outside.reason === 'below_minimum'
            ? 'The price for these answers is below the smallest amount a card payment can take'
            : 'The price for these answers is larger than a card payment can take',
          field: 'answers',
        }, 400)
      }
      visits = priced.visits
    }

    // A booking is made only with a payment held for its own price, in this currency, for the account it is recorded for,
    // and attached to no other booking.
    const [intentInUse] = await execute('SELECT 1 AS used FROM bookings WHERE payment_intent_id = ? LIMIT 1', [payment_intent_id])
    if (intentInUse) {
      return NextResponse.json(
        { success: false, message: 'This payment is already attached to a booking.' },
        { status: 409 }
      )
    }

    // Without a payment key, production refuses bookings; other environments record them as pending, unverified.
    const checkMode = paymentCheckMode({ hasKey: !!stripe, nodeEnv: process.env.NODE_ENV })
    if (checkMode === 'refuse') {
      return NextResponse.json(
        { success: false, message: 'Payments are not available right now. Please try again shortly.' },
        { status: 503 }
      )
    }

    let paymentStatus = 'pending'
    let authorizedAmount = null
    if (checkMode === 'verify') {
      // The account the booking is recorded for must hold a Stripe customer the intent can belong to.
      let payerCustomerId = null
      if (authenticatedUserId) {
        const [payer] = await execute('SELECT stripe_customer_id FROM users WHERE id = ?', [authenticatedUserId])
        payerCustomerId = payer ? payer.stripe_customer_id : null
      }
      if (!payerCustomerId) {
        return NextResponse.json(
          { success: false, message: 'This payment does not match this booking.' },
          { status: 400 }
        )
      }

      let intent
      try {
        intent = await stripe.paymentIntents.retrieve(payment_intent_id)
      } catch (err) {
        // An intent Stripe does not know is not this booking's payment: it is refused like any other payment that does not match.
        if (err.code === 'resource_missing' || err.statusCode === 404) {
          console.log(`[API Bookings] ${bookingNumber}: payment refused at check 'match'`)
          return NextResponse.json(
            { success: false, message: 'This payment does not match this booking.' },
            { status: 400 }
          )
        }
        console.error('[API Bookings] Payment retrieve failed:', err.message)
        return NextResponse.json(
          { success: false, message: 'Payments are not available right now. Please try again shortly.' },
          { status: 503 }
        )
      }
      const check = checkHeldPayment(intent, {
        amountCents: bounds.cents,
        currency: process.env.STRIPE_CURRENCY || 'cad',
        customerId: payerCustomerId,
        nowSeconds: Math.floor(Date.now() / 1000),
      })
      if (!check.ok) {
        // One line naming the booking number and which check refused, never the intent's values.
        console.log(`[API Bookings] ${bookingNumber}: payment refused at check '${check.check}'`)
        return NextResponse.json({ success: false, message: check.message }, { status: check.status })
      }
      paymentStatus = check.paymentStatus
      authorizedAmount = check.authorizedCents / 100
    }

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
          standard_duration_minutes, price_breakdown, payment_intent_id, authorized_amount)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,'pending','not_started',?,?,?,?,?)`,
        [
          bookingNumber, authenticatedUserId || null, service_id || null, service_name || null,
          basePrice, overtimeRate,
          first_name || '', last_name || '', email || '', phone || '',
          primaryJobDate || null, timeSlotString || null, finalTimingConstraints || null,
          job_description || '', instructions || null,
          parking_access ? 1 : 0, elevator_access ? 1 : 0, has_pets ? 1 : 0,
          address_line1 || '', address_line2 || null, city || '', postal_code || null,
          latitude || null, longitude || null, jobCluster,
          paymentStatus, standardDuration || 60, JSON.stringify(job.lines),
          payment_intent_id || null, authorizedAmount,
        ]
      )

      const bookingId = result.insertId

      // The visits booked, in date order: this booking first and, for a series, each later visit after it.
      const bookedVisits = [{ booking_id: bookingId, booking_number: bookingNumber, job_date: primaryJobDate, service_price: basePrice }]
      if (series) {
        // A series is named by its first visit's id, which every visit of the series carries, the first included.
        await connection.execute(
          'UPDATE bookings SET series_id = ?, series_visit = 1, series_frequency = ? WHERE id = ?',
          [bookingId, frequency, bookingId]
        )

        // Each later visit is a job of its own, with its own date, time label, price, quoted minutes, lines and number. It holds no
        // payment of its own: it is charged on the card of its series' first payment when it is done. Its timing note is the
        // customer's own, without the dates listed for the first visit.
        for (let k = 2; k <= visits.length; k++) {
          const visit = visits[k - 1]
          const visitNumber = `${bookingNumber}-${k}`
          const [visitResult] = await connection.execute(
            `INSERT INTO bookings
             (booking_number, user_id, service_id, service_name, service_price, additional_price,
              customer_first_name, customer_last_name, customer_email, customer_phone,
              job_date, job_time_slot, timing_constraints, job_description, instructions,
              parking_access, elevator_access, has_pets,
              address_line1, address_line2, city, postal_code, latitude, longitude, cluster,
              commission_percent, provider_amount, status, job_timer_status, payment_status,
              standard_duration_minutes, price_breakdown, series_id, series_visit, series_frequency)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,NULL,'pending','not_started','pending',?,?,?,?,?)`,
            [
              visitNumber, authenticatedUserId || null, service_id || null, service_name || null,
              visit.price, overtimeRate,
              first_name || '', last_name || '', email || '', phone || '',
              visit.date, visitSlot(timeSlotString, visit.date), timing_constraints || null,
              job_description || '', instructions || null,
              parking_access ? 1 : 0, elevator_access ? 1 : 0, has_pets ? 1 : 0,
              address_line1 || '', address_line2 || null, city || '', postal_code || null,
              latitude || null, longitude || null, jobCluster,
              visit.minutes || 60, JSON.stringify(visit.lines),
              bookingId, k, frequency,
            ]
          )
          bookedVisits.push({ booking_id: visitResult.insertId, booking_number: visitNumber, job_date: visit.date, service_price: visit.price })
        }
      }

      // Each visit is its own job, so the photos and the 'pending' history row are written for every visit.
      for (const visit of bookedVisits) {
        if (photos.length > 0) {
          await Promise.all(photos.map(photo =>
            connection.execute('INSERT INTO booking_photos (booking_id, photo_url) VALUES (?, ?)', [visit.booking_id, photo])
          ));
        }

        await connection.execute(
          `INSERT INTO booking_status_history (booking_id, status, notes) VALUES (?, 'pending', 'Booking created after payment authorization')`,
          [visit.booking_id]
        )
      }

      await connection.query('COMMIT')
      
      // A series is told as one booking: one activity entry, one push to the customer and one to each admin, each naming the count
      // of visits. Every visit has its own history row (above).
      const visitsNote = series ? ` (${bookedVisits.length} visits)` : ''

      // Log Activity
      logActivity({
        actor_id: authenticatedUserId || null,
        actor_type: authenticatedUserId ? 'customer' : 'system',
        actor_name: `${first_name} ${last_name}`.trim() || 'Guest',
        action: 'BOOKING_CREATED',
        entity_type: 'booking',
        entity_id: bookingId,
        details: { service_name, amount: authorizedAmount, ...(series ? { frequency, visits: bookedVisits.length } : {}) }
      })

      if (authenticatedUserId) {
        notifyUser(authenticatedUserId, 'Booking Confirmed!', `Your booking #${bookingNumber} for ${service_name}${visitsNote} has been created.`, { bookingId, bookingNumber, type: 'booking_created' }, execute, 'customer')
          .catch(err => console.error('[Push] Notification Error:', err));
      }

      // 🔔 Notify all admins (non-blocking)
      execute("SELECT id FROM users WHERE role = 'admin'").then(admins => {
        admins.forEach(admin => {
          notifyUser(admin.id, 'New Booking Created', `New booking #${bookingNumber} for ${service_name}${visitsNote}`, { bookingId, type: 'booking_created' }, execute, 'admin')
            .catch(() => { });
        });
      }).catch(_ => { });

      // Providers are told of a job when an admin pushes it to the marketplace (POST /api/admin/bookings/[id]/push).

      return NextResponse.json({
        success: true,
        booking_id: bookingId,
        booking_number: bookingNumber,
        overtime_rate: overtimeRate,
        standard_duration: standardDuration,
        service_price: basePrice,
        quoted_minutes: standardDuration,
        authorized_amount: authorizedAmount,
        message: series
          ? seriesMessage(bookedVisits.length, paymentStatus, authorizedAmount)
          : paymentStatus === 'authorized'
            ? `Booking confirmed. Your card is held for $${authorizedAmount.toFixed(2)} and is charged when the job is done.`
            : paymentStatus === 'paid'
              ? `Booking confirmed. Payment of $${authorizedAmount.toFixed(2)} received.`
              : 'Booking confirmed. Payment was not verified: payments are not configured on this server.',
        // A series also answers how often it repeats and every visit booked, in date order, the first included.
        ...(series ? { frequency, visits: bookedVisits } : {}),
      })
    } catch (err) {
      await connection.query('ROLLBACK')
      if (err && err.code === 'ER_DUP_ENTRY') {
        return NextResponse.json(
          { success: false, message: 'This payment is already attached to a booking.' },
          { status: 409 }
        )
      }
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
      // The row is read FOR UPDATE so an admin assignment and a provider claim on one job run one after the other; a job another provider holds is a 409.
      const [[current]] = await connection.execute(
        'SELECT status, service_price, additional_price, commission_percent, provider_amount, provider_id as current_provider FROM bookings WHERE id = ? FOR UPDATE',
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

      // Writing provider_id clears the push marker: a job reaches providers only through a push made while it has no provider.
      if ('provider_id' in body) {
        if (body.provider_id === null) {
          updateFields.push(
            'provider_id = NULL',
            'previous_provider_id = ?',
            'accepted_at = NULL',
            'marketplace_pushed_at = NULL',
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
          await clearBookingCrew(connection, id);
        } else {
          if (current.current_provider !== null && Number(current.current_provider) !== Number(body.provider_id)) {
            console.error(`[API PUT] Booking ${id} is held by provider ${current.current_provider}; assignment to ${body.provider_id} refused.`);
            await connection.query('ROLLBACK');
            return NextResponse.json({ success: false, message: 'This job already has a provider. Reload it to see who.' }, { status: 409 });
          }
          updateFields.push('provider_id = ?', 'marketplace_pushed_at = NULL');
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