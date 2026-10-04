// import { NextResponse } from 'next/server'
// import { verifyToken } from '@/lib/jwt'

// export async function GET(request) {
//   try {
//     const token = request.cookies.get('adminAuth')?.value
    
//     if (!token) {
//       return NextResponse.json(
//         { success: false, message: 'Unauthorized' },
//         { status: 401 }
//       )
//     }

//     // You can verify token here if you're using JWT
//     // const decoded = verifyToken(token)
    
//     return NextResponse.json({
//       success: true,
//       message: 'Authorized'
//     })

//   } catch (error) {
//     console.error('Admin me error:', error)
//     return NextResponse.json(
//       { success: false, message: 'Unauthorized' },
//       { status: 401 }
//     )
//   }
// }












// app/api/admin/me/route.js
import { NextResponse } from 'next/server'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth';

export async function GET(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    // ✅ Step 2: Database se user check karo
    const users = await execute(
      "SELECT id, email, role FROM users WHERE id = ? AND role = 'admin'",
      [auth.caller.id]
    )

    if (!users || users.length === 0) {
      return NextResponse.json(
        { success: false, message: 'Unauthorized' },
        { status: 401 }
      )
    }

    return NextResponse.json({
      success: true,
      user: users[0]
    })

  } catch (error) {
    console.error('Admin me error:', error)
    return NextResponse.json(
      { success: false, message: 'Unauthorized' },
      { status: 401 }
    )
  }
}