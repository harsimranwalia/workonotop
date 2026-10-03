// app/api/admin/invoices/[id]/preview/download/route.js
import { execute } from '@/lib/db'
import { NextResponse } from 'next/server'
import { requireCaller } from '@/lib/api-auth';

// Puppeteer is an optional dependency; if it's not installed we fall back gracefully
let puppeteer
// dynamic import helper that uses eval to prevent webpack from statically
// resolving the module name. this lets us keep puppeteer optional and avoid
// build-time errors when the package isn't installed.
const dynamicImport = (spec) => eval(`import("${spec}")`)

async function loadPuppeteer() {
  if (puppeteer) return puppeteer
  try {
    const mod = await dynamicImport('puppeteer')
    puppeteer = mod?.default || mod
  } catch (err) {
    console.warn('⚠️ puppeteer module not available, trying puppeteer-core')
    try {
      const mod = await dynamicImport('puppeteer-core')
      puppeteer = mod?.default || mod
    } catch (err2) {
      puppeteer = null
    }
  }
  return puppeteer
}

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params

    // Fetch invoice details
    const invoices = await execute(`
      SELECT * FROM invoices WHERE id = ?
    `, [id])

    if (!invoices || invoices.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Invoice not found' },
        { status: 404 }
      )
    }

    const invoice = invoices[0]

    const bookings = await execute(
      `SELECT 
        b.customer_first_name, 
        b.customer_last_name, 
        b.customer_email, 
        b.customer_phone, 
        b.address_line1,
        b.city,
        b.job_description,
        b.service_price,
        b.additional_price,
        b.provider_id,
        sp.name as provider_name,
        sp.phone as provider_phone,
        sp.email as provider_email,
        sp.rating as provider_rating,
        sp.total_jobs as provider_jobs,
        sp.specialty as provider_specialty
      FROM bookings b
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      WHERE b.id = ?`,
      [invoice.booking_id]
    )

    const booking = bookings[0] || {}

    const ratePerHour = booking.service_price || 0
    const ratePerMinute = ratePerHour / 60

    const formatDuration = (minutes) => {
      if (!minutes) return '0 min'
      if (minutes < 60) return `${minutes} min`
      const hours = Math.floor(minutes / 60)
      const mins = minutes % 60
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
    }

    const statusColor = {
      draft: '#94a3b8',
      pending: '#f59e0b',
      paid: '#10b981',
      overdue: '#ef4444',
    }[invoice.status?.toLowerCase()] || '#94a3b8'

    const customerFullName = `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || 'Customer'

    // Generate HTML
    const htmlContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invoice ${invoice.invoice_number}</title>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
        <style>
          *, *::before, *::after {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          :root {
            --ink: #0a0a0f;
            --ink-muted: #4a4a5a;
            --ink-faint: #9090a0;
            --teal: #0d9488;
            --teal-dark: #0b7a70;
            --teal-light: #ccfbf1;
            --cream: #fafaf7;
            --border: #e8e8e4;
            --white: #ffffff;
            --gold: #fbbf24;
            --purple: #8b5cf6;
            --purple-light: #ede9fe;
          }
          body {
            font-family: 'DM Sans', sans-serif;
            background: #ffffff;
            color: var(--ink);
            padding: 20px;
          }
          .page {
            width: 100%;
            max-width: 800px;
            margin: 0 auto;
          }
          .topbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
          }
          .brand {
            font-family: 'Playfair Display', serif;
            font-size: 28px;
            font-weight: 700;
          }
          .brand span { color: var(--teal); }
          .hero {
            background: var(--ink);
            color: white;
            padding: 40px;
            border-radius: 20px;
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
            margin-bottom: 30px;
          }
          .hero h2 { font-family: 'Playfair Display', serif; font-size: 48px; margin-bottom: 10px; }
          .total-hero { font-family: 'Playfair Display', serif; font-size: 54px; font-weight: 700; }
          .total-hero sup { font-size: 24px; vertical-align: super; }
          .info-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
          }
          .info-card {
            background: var(--cream);
            border: 1px solid var(--border);
            border-radius: 15px;
            padding: 20px;
          }
          .info-title { font-weight: 700; margin-bottom: 10px; color: var(--ink-muted); text-transform: uppercase; font-size: 12px; }
          .info-value { font-weight: 600; font-size: 16px; margin-bottom: 5px; }
          .metrics-row {
            display: grid;
            grid-template-columns: 1fr 1fr 1fr;
            gap: 15px;
            margin-bottom: 30px;
          }
          .metric-box {
            border: 1px solid var(--border);
            border-radius: 12px;
            padding: 15px;
            background: var(--cream);
          }
          .metric-label { font-size: 10px; text-transform: uppercase; color: var(--ink-faint); margin-bottom: 5px; }
          .metric-val { font-family: 'Playfair Display', serif; font-size: 24px; font-weight: 700; }
          .line-items {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 30px;
          }
          .line-items th { text-align: left; padding: 10px 0; border-bottom: 2px solid var(--ink); font-size: 12px; text-transform: uppercase; }
          .line-items td { padding: 15px 0; border-bottom: 1px solid var(--border); }
          .total-row {
            display: flex;
            justify-content: space-between;
            padding: 20px;
            background: var(--cream);
            border-radius: 12px;
            font-size: 24px;
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="topbar">
            <div class="brand">Work<span>On</span>Tap</div>
            <div>Invoice #${invoice.invoice_number}</div>
          </div>
          <div class="hero">
            <div>
              <h2>Invoice</h2>
              <div style="padding: 5px 15px; border: 1px solid white; border-radius: 20px; display: inline-block; font-size: 12px;">
                ${invoice.status?.toUpperCase()}
              </div>
            </div>
            <div class="total-hero"><sup>$</sup>${Number(invoice.total_amount).toFixed(2)}</div>
          </div>
          <div class="info-grid">
            <div class="info-card">
              <div class="info-title">Bill To</div>
              <div class="info-value">${customerFullName}</div>
              <div>${booking.customer_email || ''}</div>
              <div>${booking.customer_phone || ''}</div>
              <div>${booking.address_line1 || ''} ${booking.city || ''}</div>
            </div>
            <div class="info-card">
              <div class="info-title">Service Provider</div>
              <div class="info-value">${booking.provider_name || 'Not assigned'}</div>
              <div>${booking.provider_email || ''}</div>
              <div>${booking.provider_specialty || 'General'}</div>
            </div>
          </div>
          <div class="metrics-row">
            <div class="metric-box">
              <div class="metric-label">Rate</div>
              <div class="metric-val">$${Number(booking.service_price).toFixed(2)}/hr</div>
            </div>
            <div class="metric-box">
              <div class="metric-label">Duration</div>
              <div class="metric-val">${formatDuration(invoice.actual_duration)}</div>
            </div>
            <div class="metric-box" style="background: var(--ink); color: white;">
              <div class="metric-label" style="color: rgba(255,255,255,0.6);">Date</div>
              <div class="metric-val">${new Date(invoice.created_at).toLocaleDateString()}</div>
            </div>
          </div>
          <table class="line-items">
            <thead>
              <tr>
                <th>Description</th>
                <th style="text-align:right;">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <div style="font-weight:700;">${invoice.service_name || 'Home Service'}</div>
                  <div style="font-size:12px; color:var(--ink-faint);">${formatDuration(invoice.actual_duration)} of work</div>
                </td>
                <td style="text-align:right; font-weight:700;">$${Number(invoice.total_amount).toFixed(2)}</td>
              </tr>
            </tbody>
          </table>
          <div class="total-row">
            <span>Total Amount Due</span>
            <span>$${Number(invoice.total_amount).toFixed(2)}</span>
          </div>
        </div>
      </body>
      </html>
    `

    // Launch puppeteer
    // ensure puppeteer module is available
    const pp = await loadPuppeteer()
    if (!pp) {
      return NextResponse.json({ success: false, message: 'PDF export not available' }, { status: 503 })
    }
    const browser = await pp.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    })
    const page = await browser.newPage()

    // Set HTML content
    await page.setContent(htmlContent, { waitUntil: 'networkidle0' })

    // Generate PDF
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px'
      }
    })

    await browser.close()

    // Return PDF
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="invoice-${invoice.invoice_number}.pdf"`,
        'Content-Length': pdf.length.toString()
      },
    })

  } catch (error) {
    console.error('Download error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to download invoice', error: error.message },
      { status: 500 }
    )
  }
}



