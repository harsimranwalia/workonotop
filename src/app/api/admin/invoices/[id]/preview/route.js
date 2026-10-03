import { NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth';

export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { id } = await params

    const invoices = await query(
      `SELECT * FROM invoices WHERE id = ?`,
      [id]
    )

    if (invoices.length === 0) {
      return new NextResponse(`<html><body><h1>Invoice not found</h1></body></html>`, {
        headers: { 'Content-Type': 'text/html' },
        status: 404
      })
    }

    const invoice = invoices[0]

    const bookings = await query(
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
        b.worker_count,
        b.submitted_headcount,
        sp.name as provider_name,
        sp.phone as provider_phone,
        sp.email as provider_email
      FROM bookings b
      LEFT JOIN service_providers sp ON b.provider_id = sp.id
      WHERE b.id = ?`,
      [invoice.booking_id]
    )

    const booking = bookings[0] || {}

    const customerFullName = `${booking.customer_first_name || ''} ${booking.customer_last_name || ''}`.trim() || 'Customer'

    const workerCount = parseInt(booking.submitted_headcount || booking.worker_count || 1);

    // In database, base_amount and overtime_rate are stored per worker
    const baseSubtotal = Number(booking.service_price) * workerCount;
    const overtimeRateTotal = Number(invoice.overtime_rate) * workerCount;
    const overtimeSubtotal = Number(invoice.overtime_amount || 0) * workerCount;
    const jobTotal = baseSubtotal + overtimeSubtotal;

    const alreadyPaid = Number(booking.service_price);
    const remainingBalance = jobTotal - alreadyPaid;

    const hasOvertime = invoice.overtime_minutes > 0;

    const displayStatus = invoice.status ? invoice.status.toUpperCase() : 'PAID';

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Invoice ${invoice.invoice_number}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    body {
      font-family: 'Inter', sans-serif;
      background-color: #f3f4f6;
      margin: 0;
      padding: 40px 20px;
      color: #1e293b;
    }
    .invoice-container {
      max-width: 750px;
      margin: 0 auto;
      background: #ffffff;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .header {
      padding: 40px 40px 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #f1f5f9;
    }
    .header-left img {
      height: 90px;
      max-width: 300px;
      object-fit: contain;
    }
    .header-right {
      text-align: right;
    }
    .header-right h1 {
      margin: 0 0 8px 0;
      font-size: 28px;
      font-weight: 700;
      color: #0f172a;
    }
    .header-right p {
      margin: 0;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }
    .details-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      padding: 30px 40px;
      gap: 40px;
      border-bottom: 1px solid #f1f5f9;
    }
    .details-col h3 {
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin: 0 0 12px 0;
      font-weight: 600;
    }
    .details-col p {
      margin: 0 0 4px 0;
      font-size: 14px;
      color: #475569;
    }
    .details-col .strong-name {
      font-weight: 600;
      color: #0f172a;
      font-size: 15px;
      margin-bottom: 6px;
    }
    
    .payment-summary {
      padding: 40px;
    }
    .summary-title {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      margin: 0 0 20px 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .status-badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 6px;
      background: #dcfce7;
      color: #166534;
      letter-spacing: 0.05em;
    }
    .status-badge.draft { background: #f1f5f9; color: #475569; }
    .status-badge.pending { background: #fef9c3; color: #854d0e; }
    .status-badge.overdue { background: #fee2e2; color: #991b1b; }

    .line-item {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 20px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .line-title {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .line-desc {
      font-size: 13px;
      color: #64748b;
      margin: 0;
    }
    .line-amount {
      font-size: 16px;
      font-weight: 500;
      color: #0f172a;
    }
    
    /* NEW: Job Total Row (Top) */
    .job-total-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0 0 20px 0;
      border-bottom: 2px solid #e2e8f0;
      margin-bottom: 10px;
    }
    .job-total-row .title {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
    }
    .job-total-row .amount {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
    }

    .paid-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 20px 0;
      border-bottom: 2px solid #e2e8f0;
    }
    .paid-row .title {
      font-size: 15px;
      font-weight: 600;
      color: #0f172a;
    }
    .paid-row .amount {
      font-size: 16px;
      font-weight: 600;
      color: #ef4444; /* red for minus */
    }

    .final-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 24px 0 10px 0;
    }
    .final-row .title {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      margin: 0 0 4px 0;
    }
    .final-row .desc {
      font-size: 13px;
      color: #10b981;
      font-weight: 500;
      margin: 0;
    }
    .final-row .desc.unpaid {
      color: #64748b;
    }
    .final-amount {
      font-size: 32px;
      font-weight: 700;
      color: #0f766e;
      letter-spacing: -0.02em;
    }
    .footer {
      background: #ffffff;
      border-top: 1px solid #f1f5f9;
      padding: 30px 40px;
      text-align: center;
      font-size: 13px;
      color: #64748b;
    }
  </style>
</head>
<body>
  <div class="invoice-container">
    <div class="header">
      <div class="header-left">
        <img src="https://workontap.com/logo.png" alt="WorkOnTap">
      </div>
      <div class="header-right">
        <h1>Invoice</h1>
        <p>#${invoice.invoice_number}</p>
        <p>Date: ${new Date(invoice.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
      </div>
    </div>

    <div class="details-grid">
      <div class="details-col">
        <h3>Billed To</h3>
        <p class="strong-name">${customerFullName}</p>
        <p>${booking.customer_phone || ''}</p>
        <p>${booking.address_line1 || ''}</p>
        <p>${booking.city || ''}</p>
      </div>
      <div class="details-col" style="text-align: right;">
        <h3>Service Provider</h3>
        <p class="strong-name">${booking.provider_name || 'WorkOnTap Pro'}</p>
        <p>${booking.provider_phone || ''}</p>
        <p>${booking.provider_email || ''}</p>
      </div>
    </div>

    <div class="payment-summary">
      <div class="summary-title">
        ${invoice.invoice_type === 'provider' ? 'Provider Payout Summary' : 'Payment Summary'}
        <span class="status-badge ${(invoice.status || '').toLowerCase()}">${displayStatus}</span>
      </div>

      ${invoice.invoice_type === 'provider' ? `
      <!-- PROVIDER INVOICE VIEW -->
      <div class="job-total-row">
        <div class="title">Total Payout (Base + Overtime)</div>
        <div class="amount">$${(Number(invoice.final_provider_amount || invoice.provider_earnings || 0)).toFixed(2)}</div>
      </div>

      <div class="line-item">
        <div>
          <p class="line-title">Base Payout</p>
          <p class="line-desc">Base service (x${workerCount} worker${workerCount > 1 ? 's' : ''})</p>
        </div>
        <div class="line-amount">
          $${Number((invoice.final_provider_amount || invoice.provider_earnings || 0) - (invoice.overtime_earnings || 0)).toFixed(2)}
        </div>
      </div>

      <div class="line-item">
        <div>
          <p class="line-title">Overtime Payout (${invoice.overtime_minutes}min)</p>
          <p class="line-desc">Actual Overtime (x${workerCount} worker${workerCount > 1 ? 's' : ''})</p>
        </div>
        <div class="line-amount">
          +$${Number(invoice.overtime_earnings || 0).toFixed(2)}
        </div>
      </div>

      <div class="final-row" style="border-top: 2px solid #e2e8f0; margin-top: 10px; padding-top: 20px;">
        <div>
          <p class="title">Final Provider Payout</p>
        </div>
        <div class="final-amount">
          $${(Number(invoice.final_provider_amount || invoice.provider_earnings || 0)).toFixed(2)}
        </div>
      </div>
      ` : `
      <!-- CUSTOMER INVOICE VIEW -->
      <div class="line-item">
        <div>
          <p class="line-title">Base price (${invoice.service_duration}min)</p>
          <p class="line-desc">Base Service (x${workerCount} worker${workerCount > 1 ? 's' : ''})</p>
        </div>
        <div class="line-amount">
          ${baseSubtotal.toFixed(2)}
        </div>
      </div>

      ${invoice.overtime_minutes > 0 ? `
      <div class="line-item">
        <div>
          <p class="line-title">Overtime (${invoice.overtime_minutes}min at ${overtimeRateTotal.toFixed(2)}/hr)</p>
          <p class="line-desc">Actual Overtime (x${workerCount} worker${workerCount > 1 ? 's' : ''})</p>
        </div>
        <div class="line-amount">
          +${overtimeSubtotal.toFixed(2)}
        </div>
      </div>
      ` : ''}

      <div class="paid-row">
        <div class="title">Already Paid (Base Price)</div>
        <div class="amount">-${alreadyPaid.toFixed(2)}</div>
      </div>

      <div class="final-row" style="border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 10px;">
        <div>
          <p class="title" style="color: #000000;">Remaining Balance (You Pay Now)</p>
        </div>
        <div class="final-amount" style="color: #000000;">
          $${remainingBalance.toFixed(2)}
        </div>
      </div>

      <div class="job-total-row" style="background: none; border: none; padding: 0;">
        <div class="title" style="font-size: 16px; color: #1e293b;">Job Total (Base + Overtime)</div>
        <div class="amount" style="font-size: 24px;">${jobTotal.toFixed(2)}</div>
      </div>
      `}
    </div>

    <div class="footer">
      Thank you for choosing WorkOnTap! <br>
      <span style="opacity: 0.8;">support@workontap.com • 1-800-WORKONTAP</span>
    </div>
  </div>
</body>
</html>
`

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': 'no-cache'
      },
    })

  } catch (error) {
    console.error('Error:', error)
    return new NextResponse(`<html><body><h1>Error</h1><p>${error.message}</p></body></html>`, {
      headers: { 'Content-Type': 'text/html' },
      status: 500
    })
  }
}