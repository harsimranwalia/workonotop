// app/api/provider/reset-password/route.js - FIXED with correct column name
import { NextResponse } from 'next/server'
import { execute, getConnection } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { logActivity } from '@/lib/logger'

export async function POST(request) {
  let connection
  try {
    const { token, email, otp, password } = await request.json()

    console.log('🔍 Reset password attempt:', token ? 'via Link' : `for ${email} via OTP`)

    if (!password) {
      return NextResponse.json({
        success: false,
        message: 'Password required'
      }, { status: 400 })
    }

    if (!token && (!email || !otp)) {
      return NextResponse.json({
        success: false,
        message: 'Valid token or Email/OTP required'
      }, { status: 400 })
    }

    // ENG-022 S1: token is bound raw by connection.execute() below (a typed bind, not SQL text), a non-string email
    // throws at .trim() (a 500) and otp is stringified (cleanOtp); refuse anything but a string for all three first.
    if ([token, email, otp].some((value) => value != null && typeof value !== 'string')) {
      return NextResponse.json({
        success: false,
        message: 'Valid token or Email/OTP required'
      }, { status: 400 })
    }

    const passwordRegex = /^(?=.*[a-zA-Z])(?=.*[!@#$%^&*(),.?":{}|<>]).{8,}$/;
    if (!passwordRegex.test(password)) {
      return NextResponse.json({
        success: false,
        message: 'Password must be at least 8 characters and contain both alphabets and special characters'
      }, { status: 400 })
    }

    // Clean inputs
    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanOtp = (otp || '').toString().trim();

    connection = await getConnection()
    await connection.query('START TRANSACTION')

    try {
      // Find provider with valid token/OTP
      let providers = [];
      if (token) {
        // Website flow (Token)
        const [result] = await connection.execute(
          `SELECT id, email FROM service_providers 
           WHERE reset_token = ? 
           AND reset_token_expiry > NOW()`,
          [token]
        )
        providers = result;
      } else {
        // Mobile flow (Email + OTP)
        console.log(`🔍 DIAGNOSTIC: Attempting reset for [${cleanEmail}] with OTP [${cleanOtp}]`);

        // 1. Get current state of this provider
        const [currentState] = await connection.execute(
          `SELECT id, email, reset_token, reset_token_expiry, NOW() as db_now 
           FROM service_providers WHERE LOWER(email) = ?`,
          [cleanEmail]
        );

        if (currentState.length === 0) {
          console.log(`❌ DIAGNOSTIC: No provider found for email [${cleanEmail}]`);
        } else {
          const p = currentState[0];
          const tokenMatch = p.reset_token === cleanOtp;
          const notExpired = new Date(p.reset_token_expiry) > new Date(p.db_now);
          console.log(`📊 DIAGNOSTIC: Provider ID: ${p.id}`);
          console.log(`📊 DIAGNOSTIC: DB Token: [${p.reset_token}], Input OTP: [${cleanOtp}], MATCH: ${tokenMatch}`);
          console.log(`📊 DIAGNOSTIC: DB Expiry: ${p.reset_token_expiry}, DB Now: ${p.db_now}, VALID: ${notExpired}`);

          if (!tokenMatch) console.log('💡 TIP: Check if verify-otp is prematurely clearing the token.');
        }

        const [result] = await connection.execute(
          `SELECT id, email FROM service_providers 
           WHERE LOWER(email) = ?
           AND reset_token = ? 
           AND reset_token_expiry > NOW()`,
          [cleanEmail, cleanOtp]
        )
        providers = result;
      }

      console.log('📊 Providers found:', providers.length)

      if (providers.length === 0) {
        await connection.query('ROLLBACK')
        return NextResponse.json({
          success: false,
          message: 'Invalid or expired reset credentials'
        }, { status: 400 })
      }

      const provider = providers[0]
      console.log('✅ Valid provider found:', provider.id, provider.email)

      // Hash new password
      const hashedPassword = await bcrypt.hash(password, 10)

      // Update password and clear reset token
      // ⚠️ IMPORTANT: Check your database column name - it might be 'password' or 'hashed_password'
      // Try one of these options:

      // OPTION 1: If your column is 'password' (most common)
      await connection.execute(
        `UPDATE service_providers 
         SET password = ?, 
             reset_token = NULL, 
             reset_token_expiry = NULL,
             updated_at = NOW()
         WHERE id = ?`,
        [hashedPassword, provider.id]
      )

      // OPTION 2: If your column is 'hashed_password' (uncomment if needed)
      /*
      await connection.execute(
        `UPDATE service_providers 
         SET hashed_password = ?, 
             reset_token = NULL, 
             reset_token_expiry = NULL,
             updated_at = NOW()
         WHERE id = ?`,
        [hashedPassword, provider.id]
      )
      */

      // OPTION 3: If your column is 'password_hash' (but it's not working)
      // Then you need to add this column or use the correct existing one

      await connection.query('COMMIT')
      console.log('💾 Password updated successfully')

      // Log Activity
      logActivity({
        actor_id: provider.id,
        actor_type: 'provider',
        actor_name: `Provider #${provider.id}`, // fallback to ID
        action: 'PROVIDER_PASSWORD_RESET',
        entity_type: 'auth',
        entity_id: provider.id
      })

      return NextResponse.json({
        success: true,
        message: 'Password reset successfully'
      })

    } catch (err) {
      await connection.query('ROLLBACK')
      console.error('❌ Database error in reset-password:', err)
      throw err
    } finally {
      if (connection) connection.release()
    }

  } catch (error) {
    console.error('🔥 Reset password error:', error)
    return NextResponse.json({
      success: false,
      message: 'Failed to reset password'
    }, { status: 500 })
  }
}