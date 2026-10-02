// The credential families the app reads, so a test can say which one is missing. A name written A|B is
// satisfied by either (src/lib/email.js checks SMTP_USER or EMAIL_USER, and SMTP_PASS or EMAIL_PASS).
export const CREDENTIALS = {
    stripe: ['STRIPE_SECRET_KEY'],
    stripeJs: ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY'],
    sms: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'],
    email: ['SMTP_USER|EMAIL_USER', 'SMTP_PASS|EMAIL_PASS'],
};

/**
 * Returns the credential names the app is missing for a family, and when there are any marks the test as
 * "verified by what the code attempts": a test then asserts what the code attempts, never the outcome a
 * real credential would give, and the reporter prints ATTEMPTED instead of PASS.
 *
 * Which names the app has comes from E2E_APP_ENV_NAMES, a comma-separated list of names (never values)
 * that the test command reads from the app. If it is unset, every credential counts as missing, so the
 * mistake that costs nothing is a case reported as ATTEMPTED, never one reported as PASS.
 * @param {import('@playwright/test').TestInfo} testInfo
 * @param {keyof typeof CREDENTIALS} family
 */
export function credentialGap(testInfo, family) {
    const required = CREDENTIALS[family];
    if (!required) {
        throw new Error(`credentialGap: unknown family '${family}'; use one of ${Object.keys(CREDENTIALS).join(', ')}`);
    }

    const present = new Set((process.env.E2E_APP_ENV_NAMES || '').split(',').map((name) => name.trim()).filter(Boolean));
    const missing = required.filter((requirement) => !requirement.split('|').some((name) => present.has(name)));
    if (missing.length > 0) {
        testInfo.annotations.push({ type: 'verified-by-attempt', description: `missing: ${missing.join(', ')}` });
    }
    return missing;
}
