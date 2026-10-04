// app/api/provider/verify-otp/route.js
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'

export async function POST(request) {
    try {
        const { email, otp } = await request.json()

        if (!email || !otp) {
            return NextResponse.json({
                success: false,
                message: 'Email and verification code required'
            }, { status: 400 })
        }

        // ENG-022 S1: email reaches .trim() next (a 500 for a non-string) and both values go into execute() below;
        // refuse anything but a string for either first.
        if (typeof email !== 'string' || typeof otp !== 'string') {
            return NextResponse.json({
                success: false,
                message: 'Email and verification code required'
            }, { status: 400 })
        }

        const cleanEmail = (email || '').trim().toLowerCase();
        const cleanOtp = (otp || '').toString().trim();

        console.log(`🔍 DIAGNOSTIC: OTP verification for [${cleanEmail}] with OTP [${cleanOtp}]`);

        // Check if provider exists with valid token
        let providers = await execute(
            `SELECT id FROM service_providers 
        WHERE LOWER(TRIM(email)) = ? 
        AND CAST(reset_token AS CHAR) = ? 
        AND (reset_token_expiry IS NULL OR reset_token_expiry > NOW())`,
            [cleanEmail, cleanOtp]
        )

        // Fallback: Check users table if user registered in users table
        if (providers.length === 0) {
            providers = await execute(
                `SELECT id FROM users 
            WHERE LOWER(TRIM(email)) = ? 
            AND CAST(reset_token AS CHAR) = ? 
            AND (reset_token_expiry IS NULL OR reset_token_expiry > NOW())`,
                [cleanEmail, cleanOtp]
            )
        }

        console.log(`📊 DIAGNOSTIC: Verification result - Rows found: ${providers.length}`);

        if (providers.length === 0) {
            return NextResponse.json({
                success: false,
                message: 'Invalid or expired verification code'
            }, { status: 400 })
        }

        // ✅ Mark email as verified, but don't clear reset token yet.
        // The mobile ResetPasswordScreen needs this token to exist in the DB 
        // when it calls /api/provider/reset-password in the next step.
        await execute(
            `UPDATE service_providers SET email_verified = 1 WHERE id = ?`,
            [providers[0].id]
        )

        return NextResponse.json({
            success: true,
            message: 'Verification successful'
        })

    } catch (error) {
        console.error('🔥 Verify OTP error:', error)
        return NextResponse.json({
            success: false,
            message: 'Failed to process request'
        }, { status: 500 })
    }
}
