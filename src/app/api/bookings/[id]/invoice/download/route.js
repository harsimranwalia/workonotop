import { NextResponse } from 'next/server';
import { execute } from '@/lib/db';
import { requireCaller } from '@/lib/api-auth';
import { renderToStream } from '@react-pdf/renderer';
import InvoicePDF from '@/components/invoices/InvoicePDF';
import React from 'react';

// A browser page visit (it asks for HTML) that carries no login is sent to the website's customer login, which comes
// back to this invoice once the customer has signed in (the login page reads ?redirect=). Every other refusal, and every
// refusal for someone who is signed in, stays the guard's own answer. The return path is built here from a booking number
// of digits, never from the request's url, so it cannot name another place. Returns the redirect, or null.
function signInRedirect(request, refusal, bookingId) {
  const asksForHtml = (request.headers.get('accept') || '').includes('text/html');
  if (refusal.status !== 401 || !asksForHtml || !/^[0-9]{1,18}$/.test(bookingId)) return null;
  const returnPath = `/api/bookings/${bookingId}/invoice/download`;
  return new Response(null, {
    status: 307,
    headers: { Location: `/login?redirect=${encodeURIComponent(returnPath)}`, 'Cache-Control': 'no-store' },
  });
}

// The invoice of a booking goes to that booking's own customer and to admins.
export async function GET(request, { params }) {
  const auth = await requireCaller(request, ['customer', 'admin']);
  const signIn = auth.ok ? null : signInRedirect(request, auth.response, (await params).id);
  if (signIn) return signIn;
  if (!auth.ok) return auth.response;
  try {
    const { id: bookingId } = await params;

    // Fetch booking details
    const bookings = await execute(
      `SELECT * FROM bookings WHERE id = ?`,
      [bookingId]
    );

    const booking = bookings[0];

    if (!booking) {
      return NextResponse.json({ success: false, message: 'Booking not found' }, { status: 404 });
    }

    // A customer gets the invoice of their own booking only; the id compared is the signed-in customer's, never one from the request.
    if (auth.caller.role !== 'admin' && String(booking.user_id) !== String(auth.caller.id)) {
      return NextResponse.json({ success: false, message: 'Forbidden' }, { status: 403 });
    }

    // Determine or generate invoice number
    // We check if an invoice already exists
    const existingInvoices = await execute(
      'SELECT invoice_number, created_at FROM invoices WHERE booking_id = ? AND invoice_type = "customer"',
      [bookingId]
    );

    let invoiceNumber;
    let invoiceDate;

    if (existingInvoices.length > 0) {
      invoiceNumber = existingInvoices[0].invoice_number;
      invoiceDate = new Date(existingInvoices[0].created_at).toLocaleDateString();
    } else {
      // Temporary invoice number for early receipts
      invoiceNumber = `REC-${new Date().getFullYear()}-${String(bookingId).padStart(5, '0')}`;
      invoiceDate = new Date().toLocaleDateString();
    }

    // Render PDF to stream
    const stream = await renderToStream(
      <InvoicePDF 
        booking={booking} 
        invoiceNumber={invoiceNumber} 
        date={invoiceDate} 
      />
    );

    // Convert stream to Buffer (Next.js 15 friendly)
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const pdfBuffer = Buffer.concat(chunks);

    return new NextResponse(pdfBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="Invoice-${invoiceNumber}.pdf"`,
      },
    });

  } catch (error) {
    console.error('Error downloading invoice:', error);
    return NextResponse.json({ 
      success: false, 
      message: 'Failed to generate invoice PDF: ' + error.message 
    }, { status: 500 });
  }
}
