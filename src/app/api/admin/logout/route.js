// app/api/admin/logout/route.js
import { NextResponse } from "next/server";
import jwt from 'jsonwebtoken';
import { jwtSecret } from '@/lib/jwt';
import { logActivity } from '@/lib/logger';

export async function POST(request) {
  const token = request.cookies.get('adminAuth')?.value;
  if (token) {
    try {
      const decoded = jwt.verify(token, jwtSecret());
      if (decoded) {
        logActivity({
          actor_id: decoded.id,
          actor_type: 'admin',
          actor_name: `Admin #${decoded.id}`, // Or try to get name from token if available
          action: 'ADMIN_LOGGED_OUT',
          entity_type: 'auth',
          entity_id: decoded.id
        });
      }
    } catch (e) {
      // Token might be invalid or expired, ignore
    }
  }

  const response = NextResponse.json({
    success: true,
    message: "Logged out successfully"
  });

  // Clear the auth cookies
  response.cookies.delete("adminAuth");
  response.cookies.delete("adminLoggedIn");

  return response;
}