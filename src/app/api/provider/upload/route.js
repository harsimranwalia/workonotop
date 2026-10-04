// import { NextResponse } from 'next/server'
// import { writeFile, mkdir } from 'fs/promises'
// import path from 'path'
// import jwt from 'jsonwebtoken'
// import { query } from '@/lib/db'

// const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this'

// export async function POST(request) {
//   try {
//     // Verify token
//     const token = request.headers.get('Authorization')?.split(' ')[1]
//     if (!token) {
//       return NextResponse.json(
//         { success: false, message: 'Unauthorized' },
//         { status: 401 }
//       )
//     }

//     let decoded
//     try {
//       decoded = jwt.verify(token, JWT_SECRET)
//     } catch (error) {
//       return NextResponse.json(
//         { success: false, message: 'Invalid token' },
//         { status: 401 }
//       )
//     }

//     const formData = await request.formData()
//     const file = formData.get('file')
    
//     if (!file) {
//       return NextResponse.json(
//         { success: false, message: 'No file uploaded' },
//         { status: 400 }
//       )
//     }

//     // Check file type
//     if (!file.type.startsWith('image/')) {
//       return NextResponse.json(
//         { success: false, message: 'Please upload only image files' },
//         { status: 400 }
//       )
//     }

//     // Check file size (5MB limit for profile pictures)
//     if (file.size > 5 * 1024 * 1024) {
//       return NextResponse.json(
//         { success: false, message: 'File size exceeds 5MB' },
//         { status: 400 }
//       )
//     }

//     const bytes = await file.arrayBuffer()
//     const buffer = Buffer.from(bytes)
    
//     // Create uploads directory if it doesn't exist
//     const uploadDir = path.join(process.cwd(), 'public/uploads/providers')
//     await mkdir(uploadDir, { recursive: true })
    
//     // Generate unique filename
//     const timestamp = Date.now()
//     const ext = path.extname(file.name)
//     const filename = `provider-${decoded.id}-${timestamp}${ext}`
//     const filepath = path.join(uploadDir, filename)
    
//     // Save file
//     await writeFile(filepath, buffer)
    
//     // Return the public URL
//     const imageUrl = `/uploads/providers/${filename}`
    
//     // Update database with new avatar URL
//     await query(
//       'UPDATE service_providers SET avatar_url = ?, updated_at = NOW() WHERE id = ?',
//       [imageUrl, decoded.id]
//     )
    
//     return NextResponse.json({
//       success: true,
//       url: imageUrl,
//       message: 'Profile picture uploaded successfully'
//     })
    
//   } catch (error) {
//     console.error('Upload error:', error)
//     return NextResponse.json(
//       { success: false, message: 'Upload failed' },
//       { status: 500 }
//     )
//   }
// }











// app/api/provider/upload/route.js
import { NextResponse } from 'next/server'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'
import { execute } from '@/lib/db'
import { requireCaller } from '@/lib/api-auth'
import { logActivity } from '@/lib/logger'

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id
  try {
    const formData = await request.formData()
    const file = formData.get('file')
    const documentType = formData.get('type') || 'profile_photo'

    if (!file) {
      return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 })
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf']
    if (!allowedTypes.includes(file.type)) {
      return NextResponse.json({ success: false, message: 'Invalid file type' }, { status: 400 })
    }

    // Validate file size (5MB)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ success: false, message: 'File too large (max 5MB)' }, { status: 400 })
    }

    const bytes = await file.arrayBuffer()
    const buffer = Buffer.from(bytes)

    // Create filename
    const timestamp = Date.now()
    const ext = path.extname(file.name)
    const filename = `${providerId}-${documentType}-${timestamp}${ext}`
    
    // Ensure upload directory exists
    const uploadDir = path.join(process.cwd(), 'public/uploads')
    await mkdir(uploadDir, { recursive: true })

    // Save file
    const filepath = path.join(uploadDir, filename)
    await writeFile(filepath, buffer)
    
    // Public URL
    const publicUrl = `/uploads/${filename}`

    // Store in documents table with correct column name 'document_url'
    await execute(
      `INSERT INTO provider_documents 
       (provider_id, document_type, document_url, status, created_at, updated_at) 
       VALUES (?, ?, ?, 'pending', NOW(), NOW())`,
      [providerId, documentType, publicUrl]
    )

    // If it's a profile photo, update the avatar_url in service_providers table
    if (documentType === 'profile_photo') {
      await execute(
        `UPDATE service_providers SET avatar_url = ? WHERE id = ?`,
        [publicUrl, providerId]
      )
    }

    // Update documents_uploaded count in service_providers
    await execute(
      `UPDATE service_providers 
       SET documents_uploaded = (
         SELECT COUNT(*) FROM provider_documents WHERE provider_id = ?
       ) WHERE id = ?`,
      [providerId, providerId]
    )

    // Log Activity
    logActivity({
      actor_id: providerId,
      actor_type: 'provider',
      actor_name: auth.caller.email || 'Provider',
      action: 'PROVIDER_DOCUMENT_UPLOADED',
      entity_type: 'document',
      entity_id: providerId, // or the document id if we had it easily, using providerId for now
      details: { document_type: documentType, url: publicUrl }
    })

    return NextResponse.json({ 
      success: true, 
      message: 'File uploaded successfully',
      url: publicUrl 
    })

  } catch (error) {
    console.error('Upload error:', error)
    return NextResponse.json({ success: false, message: 'Upload failed' }, { status: 500 })
  }
}