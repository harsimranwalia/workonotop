// The customer's job-completed e-mail. Every value placed in the HTML is escaped, so names, addresses
// and the provider's summary and recommendations show as the text that was entered, line breaks included.

export function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function textAsHtml(value) {
  return escapeHtml(value).replace(/\r\n|\r|\n/g, '<br>')
}

export function jobCompletedEmailHtml({
  customerName, providerName, serviceName, bookingNumber, startTime, finishedAt, totalMinutes, overtimeMinutes,
  price, workSummary, recommendations, beforePhotos, afterPhotos, baseUrl, bookingId
}) {
  const formatDuration = (mins) => {
    if (!mins) return 'N/A'
    const h = Math.floor(mins / 60)
    const m = mins % 60
    if (h > 0 && m > 0) return `${h}h ${m}m`
    if (h > 0) return `${h}h`
    return `${m} min`
  }

  const formatDateTime = (dt) => {
    if (!dt) return 'N/A'
    return new Date(dt).toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  }

  const approveUrl = `${baseUrl}/my-bookings/${bookingId}?action=approve`
  const disputeUrl = `${baseUrl}/my-bookings/${bookingId}?action=dispute`

  const getAbsoluteUrl = (url) => {
    if (!url) return ''
    if (url.startsWith('http')) return url
    return `${baseUrl}${url}`
  }

  const renderPhotoSection = (label, photos, color) => {
    if (!photos || photos.length === 0) return ''
    return `
                <div style="margin-top: 24px;">
                  <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:${escapeHtml(color)};text-transform:uppercase;letter-spacing:0.5px;">📸 ${escapeHtml(label)} Photos</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:0;">
                        ${photos.map(url => `
                          <div style="display:inline-block;width:170px;margin-right:10px;margin-bottom:10px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0;background:#f8fafc;">
                            <img src="${escapeHtml(getAbsoluteUrl(url))}" alt="${escapeHtml(label)}" style="width:170px;height:170px;object-cover;display:block;" />
                          </div>
                        `).join('')}
                      </td>
                    </tr>
                  </table>
                </div>
              `
  }

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/></head>
<body style="margin:0;padding:0;background-color:#f0f4f8;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f4f8;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

        <!-- Logo -->
        <tr><td align="center" style="padding-bottom:20px;">
          <span style="font-size:22px;font-weight:700;color:#0f766e;letter-spacing:-0.5px;">Work<span style="color:#0891b2;">On</span>Tap</span>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

          <!-- Header -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="background:linear-gradient(135deg,#15803d 0%,#0891b2 100%);padding:40px 32px;text-align:center;">
              <div style="font-size:48px;margin-bottom:12px;">✅</div>
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;">Job Completed!</h1>
            </td></tr>
          </table>

          <!-- Body -->
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:36px 40px 32px;">

              <p style="margin:0 0 6px;font-size:18px;font-weight:600;color:#0f172a;">Hi ${escapeHtml(customerName)} 👋</p>
              <p style="margin:0 0 24px;font-size:15px;color:#475569;line-height:1.7;">
                Your <strong>${escapeHtml(serviceName)}</strong> service has been completed by <strong>${escapeHtml(providerName)}</strong>.
                Here's a full summary of the work done.
              </p>

              <!-- Job Info -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:20px 24px;">
                  <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Job Details</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;width:140px;">Booking #</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(bookingNumber)}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Service</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(serviceName)}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Provider</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(providerName)}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Started</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(formatDateTime(startTime))}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Completed</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;">${escapeHtml(formatDateTime(finishedAt))}</td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Duration</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:700;color:#16a34a;">${escapeHtml(formatDuration(totalMinutes))}</td>
                    </tr>
                    ${overtimeMinutes > 0 ? `
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Overtime</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#15843E;">${escapeHtml(formatDuration(overtimeMinutes))}</td>
                    </tr>
                    ` : ''}
                  </table>
                </td></tr>
              </table>

              <!-- Invoice Summary -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:24px;">
                <tr><td style="padding:20px 24px;">
                  <p style="margin:0 0 14px;font-size:13px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.5px;">Invoice Summary</p>
                  <table width="100%" cellpadding="0" cellspacing="0">
                    <tr>
                      <td style="padding:5px 0;font-size:14px;color:#64748b;">Base Price</td>
                      <td style="padding:5px 0;font-size:14px;font-weight:600;color:#0f172a;text-align:right;">$${escapeHtml(price.toFixed(2))}</td>
                    </tr>
                    <tr>
                      <td colspan="2" style="padding:10px 0;"><hr style="border:none;border-top:1px solid #e2e8f0;" /></td>
                    </tr>
                    <tr>
                      <td style="padding:5px 0;font-size:16px;font-weight:700;color:#0f172a;">Total Amount Due</td>
                      <td style="padding:5px 0;font-size:18px;font-weight:800;color:#16a34a;text-align:right;">$${escapeHtml(price.toFixed(2))}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>

              <!-- Work Summary -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #86efac;border-left:4px solid #16a34a;border-radius:8px;margin-bottom:24px;">
                <tr><td style="padding:18px 20px;">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.5px;">✅ Work Summary</p>
                  <p style="margin:0;font-size:14px;color:#166534;line-height:1.7;">${textAsHtml(workSummary || 'Job completed successfully.')}</p>
                </td></tr>
              </table>

              ${recommendations ? `
              <!-- Recommendations -->
              <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff7ed;border:1px solid #fed7aa;border-left:4px solid #f97316;border-radius:8px;margin-bottom:24px;">
                <tr><td style="padding:18px 20px;">
                  <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#c2410c;text-transform:uppercase;letter-spacing:0.5px;">🔧 Recommendations</p>
                  <p style="margin:0;font-size:14px;color:#7c2d12;line-height:1.7;">${textAsHtml(recommendations)}</p>
                </td></tr>
              </table>
              ` : ''}

              <!-- Photos Section -->
              ${renderPhotoSection('Before', beforePhotos, '#f97316')}
              ${renderPhotoSection('After', afterPhotos, '#16a34a')}

              <hr style="border:none;border-top:1px solid #e2e8f0;margin:32px 0 24px;" />

              <!-- CTA Buttons -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:32px;">
                <tr>
                  <td align="center">
                    <table cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding:0 10px;">
                          <a href="${escapeHtml(approveUrl)}"
                             style="display:inline-block;padding:14px 30px;background:#16a34a;color:#ffffff;text-decoration:none;border-radius:10px;font-size:15px;font-weight:700;box-shadow:0 4px 12px rgba(22,163,74,0.2);">
                            ✅ Accept & Pay
                          </a>
                        </td>
                        <td style="padding:0 10px;">
                          <a href="${escapeHtml(disputeUrl)}"
                             style="display:inline-block;padding:14px 30px;background:#ffffff;color:#dc2626;text-decoration:none;border:2px solid #dc2626;border-radius:10px;font-size:15px;font-weight:700;">
                            ⚠️ Dispute
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:14px;color:#64748b;line-height:1.7;text-align:center;">
                If no action is taken, the job will be automatically approved in 12 hours.
              </p>

              <p style="margin:20px 0 0;font-size:13px;color:#94a3b8;line-height:1.7;text-align:center;">
                Questions? Contact us at <a href="mailto:support@workontap.com" style="color:#0891b2;text-decoration:none;">support@workontap.com</a>
              </p>

            </td></tr>
          </table>

        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0;font-size:13px;color:#94a3b8;">© ${escapeHtml(new Date().getFullYear())} WorkOnTap · Calgary, Alberta, Canada</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`
}
