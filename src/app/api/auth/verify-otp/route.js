import { NextResponse } from 'next/server'
import { query } from '@/lib/db'

export async function POST(request) {
    try {
        const { email, otp } = await request.json()

        if (!email || !otp) {
            return NextResponse.json({ success: false, message: 'Email and OTP are required' }, { status: 400 })
        }

        // ENG-022 S1: a non-string email throws at .trim() below (a 500) and otp is stringified, so no non-string
        // reaches query() here; refuse either with 400 first (a 500 becomes a 400, a JSON-number otp is not coerced).
        if (typeof email !== 'string' || typeof otp !== 'string') {
            return NextResponse.json({ success: false, message: 'Email and OTP are required' }, { status: 400 })
        }

        const cleanEmail = (email || '').trim().toLowerCase();
        const cleanOtp = (otp || '').toString().trim();

        // Check if OTP matches and is not expired
        let users = await query(
            `SELECT id FROM users WHERE LOWER(TRIM(email)) = ? AND CAST(reset_token AS CHAR) = ? AND (reset_token_expiry IS NULL OR reset_token_expiry > NOW()) AND role = 'user'`,
            [cleanEmail, cleanOtp]
        )

        // Fallback: Check service_providers table
        if (users.length === 0) {
            users = await query(
                `SELECT id FROM service_providers WHERE LOWER(TRIM(email)) = ? AND CAST(reset_token AS CHAR) = ? AND (reset_token_expiry IS NULL OR reset_token_expiry > NOW())`,
                [cleanEmail, cleanOtp]
            )
        }

        if (users.length === 0) {
            return NextResponse.json({ success: false, message: 'Invalid or expired verification code' }, { status: 400 })
        }

        return NextResponse.json({ success: true, message: 'Verification successful' })

    } catch (error) {
        console.error('Customer verify-otp error:', error)
        return NextResponse.json({ success: false, message: 'Failed to verify OTP' }, { status: 500 })
    }
}
