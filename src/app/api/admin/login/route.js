// // // app/api/admin/auth/login/route.js - FIXED
// // import { NextResponse } from "next/server";
// // import bcrypt from "bcryptjs";
// // import { execute } from "@/lib/db";  // ✅ CHANGE: query → execute

// // export async function POST(request) {
// //   try {
// //     const { email, password } = await request.json();

// //     if (!email || !password) {
// //       return NextResponse.json(
// //         { success: false, message: "Email and password are required" },
// //         { status: 400 }
// //       );
// //     }

// //     // ✅ CHANGE: query → execute
// //     const users = await execute(
// //       "SELECT * FROM users WHERE email = ? AND role = 'admin'",
// //       [email]
// //     );

// //     const adminUser = users[0];

// //     if (!adminUser) {
// //       return NextResponse.json(
// //         { success: false, message: "Invalid credentials" },
// //         { status: 401 }
// //       );
// //     }

// //     const isMatch = await bcrypt.compare(password, adminUser.password_hash);

// //     if (!isMatch) {
// //       return NextResponse.json(
// //         { success: false, message: "Invalid credentials" },
// //         { status: 401 }
// //       );
// //     }

// //     // Set cookie for middleware
// //     const response = NextResponse.json({
// //       success: true,
// //       message: "Login successful",
// //       token: "admin-logged-in"
// //     });

// //     response.cookies.set("adminAuth", "admin", {
// //       httpOnly: true,
// //       secure: process.env.NODE_ENV === "production",
// //       sameSite: "lax",
// //       path: "/",
// //       maxAge: 60 * 60 * 24,
// //     });

// //     return response;

// //   } catch (error) {
// //     console.error("Login error:", error);
// //     return NextResponse.json(
// //       { success: false, message: "Server error" },
// //       { status: 500 }
// //     );
// //   }
// // }





















// // app/api/admin/auth/login/route.js
// import { NextResponse } from "next/server";
// import bcrypt from "bcryptjs";
// import jwt from "jsonwebtoken";
// import { execute } from "@/lib/db";

// const JWT_SECRET = process.env.JWT_SECRET;
// const JWT_EXPIRES_IN = "24h";

// export async function POST(request) {
//   try {
//     const { email, password } = await request.json();

//     if (!email || !password) {
//       return NextResponse.json(
//         { success: false, message: "Email and password are required" },
//         { status: 400 }
//       );
//     }

//     const users = await execute(
//       "SELECT * FROM users WHERE email = ? AND role = 'admin'",
//       [email]
//     );

//     const adminUser = users[0];

//     if (!adminUser) {
//       return NextResponse.json(
//         { success: false, message: "Invalid credentials" },
//         { status: 401 }
//       );
//     }

//     const isMatch = await bcrypt.compare(password, adminUser.password_hash);

//     if (!isMatch) {
//       return NextResponse.json(
//         { success: false, message: "Invalid credentials" },
//         { status: 401 }
//       );
//     }

//     // ✅ Sign JWT with user identity
//     const token = jwt.sign(
//       {
//         id: adminUser.id,
//         email: adminUser.email,
//         role: adminUser.role,
//       },
//       JWT_SECRET,
//       { expiresIn: JWT_EXPIRES_IN }
//     );

//     const response = NextResponse.json({
//       success: true,
//       message: "Login successful",
//       token, // optionally expose for client-side use
//     });

//     // ✅ Store JWT in httpOnly cookie for middleware
//     response.cookies.set("adminAuth", token, {
//       httpOnly: true,
//       secure: process.env.NODE_ENV === "production",
//       sameSite: "lax",
//       path: "/",
//       maxAge: 60 * 60 * 24, // 24h
//     });

//     return response;

//   } catch (error) {
//     console.error("Login error:", error);
//     return NextResponse.json(
//       { success: false, message: "Server error" },
//       { status: 500 }
//     );
//   }
// }




























// app/api/admin/login/route.js  (moved from /auth/login)
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { execute } from "@/lib/db";
import { jwtSecret } from "@/lib/jwt";
import { logActivity } from "@/lib/logger";

export async function POST(request) {
  try {
    // Sessions are signed with the configured JWT_SECRET (src/lib/jwt.js);
    // without it this route answers before it reads the request.
    const secret = jwtSecret();
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, message: "Email and password are required" },
        { status: 400 }
      );
    }

    const users = await execute(
      "SELECT * FROM users WHERE email = ? AND role = 'admin'",
      [email]
    );

    const adminUser = users[0];

    if (!adminUser) {
      return NextResponse.json(
        { success: false, message: "Invalid credentials" },
        { status: 401 }
      );
    }

    const isMatch = await bcrypt.compare(password, adminUser.password_hash);

    if (!isMatch) {
      return NextResponse.json(
        { success: false, message: "Invalid credentials" },
        { status: 401 }
      );
    }

    const token = jwt.sign(
      { id: adminUser.id, email: adminUser.email, role: adminUser.role },
      secret,
      { expiresIn: "24h" }
    );

    const response = NextResponse.json({
      success: true,
      message: "Login successful",
    });

    // Log Activity
    logActivity({
      actor_id: adminUser.id,
      actor_type: 'admin',
      actor_name: `${adminUser.first_name || ''} ${adminUser.last_name || ''}`.trim() || 'Admin',
      action: 'ADMIN_LOGGED_IN',
      entity_type: 'admin',
      entity_id: adminUser.id,
      details: { email: adminUser.email }
    });

    response.cookies.set("adminAuth", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24,
    });

    return response;

  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, message: "Server error" },
      { status: 500 }
    );
  }
}