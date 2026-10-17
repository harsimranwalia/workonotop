// src/lib/sms.js
//
// The one way the app sends a text (Twilio). sendSMSResult(to, message) answers { ok, reason } and sendSMS(to, message) answers just `ok`: true when
// Twilio accepted the message and false otherwise. Neither throws. They are one implementation: sendSMS is sendSMSResult's `ok`, so the two cannot
// drift apart, and the code flows that inject a sendText (job-link-code.js, crew-number-check.js) keep the boolean they were written against.
//   reason  'sent'                     Twilio accepted the message (HTTP 2xx)
//           'bad_number'               the number is not one normalisePhone can read
//           'destination_not_allowed'  the number is not a Canadian one (canText)
//           'not_configured'           one of the three Twilio variables is missing; no call was made
//           'rejected'                 Twilio answered with a non-2xx status: the message did not go
//           'unsure'                   the call timed out or threw: the message may or may not have gone, and a caller that must not text twice
//                                      (src/lib/notices.js) treats it as sent
//
// A text goes only to a Canadian number (ENG-015, ADR-012): `to` is read by normalisePhone in src/lib/phone.js and then must pass canText, so there
// is no default country (the old helper put +91 on every bare ten-digit number and so texted Canadian numbers to India) and a number that is not
// Canadian is never paid to reach. Both checks run before the credentials and the network, so a refused number makes no call at all.
//
// It logs fixed lines and nothing that comes from the call: never the number, the message, the response body or the credentials.
//   SMS not sent: bad_number | SMS not sent: destination_not_allowed | Twilio credentials not configured in .env. Skipping SMS. | SMS sent
//   Twilio error {http status} {Twilio's numeric error code}      (the code is read from the JSON body; the body, which names the number, is not logged)
//   Error sending SMS via Twilio: {error.code or error.name}
import { normalisePhone, canText } from './phone.js';

// A call that does not answer in this long is given up on, so a slow Twilio cannot hold a request open.
const TIMEOUT_MS = 10000;

export async function sendSMSResult(to, message) {
    const phone = normalisePhone(String(to ?? ''));
    if (!phone.ok) {
        console.log('SMS not sent: bad_number');
        return { ok: false, reason: 'bad_number' };
    }
    if (!canText(phone.phone)) {
        console.log('SMS not sent: destination_not_allowed');
        return { ok: false, reason: 'destination_not_allowed' };
    }

    const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
    const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
    const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

    if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_PHONE_NUMBER) {
        console.log('Twilio credentials not configured in .env. Skipping SMS.');
        return { ok: false, reason: 'not_configured' };
    }

    try {
        const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
        const formData = new URLSearchParams();
        formData.append('To', phone.phone);
        formData.append('From', TWILIO_PHONE_NUMBER);
        formData.append('Body', String(message ?? ''));

        const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: formData.toString(),
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });

        if (!response.ok) {
            let twilioCode = 'unknown';
            try {
                const body = await response.json();
                if (Number.isInteger(body?.code)) twilioCode = String(body.code);
            } catch {
                // A body that is not JSON has no code to log.
            }
            console.error(`Twilio error ${response.status} ${twilioCode}`);
            return { ok: false, reason: 'rejected' };
        }

        console.log('SMS sent');
        return { ok: true, reason: 'sent' };
    } catch (e) {
        console.error(`Error sending SMS via Twilio: ${e?.code || e?.name || 'unknown'}`);
        return { ok: false, reason: 'unsure' };
    }
}

export async function sendSMS(to, message) {
    return (await sendSMSResult(to, message)).ok;
}
