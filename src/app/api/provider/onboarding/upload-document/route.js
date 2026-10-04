// app/api/provider/onboarding/upload-document/route.js
import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';
import { execute } from '@/lib/db';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';

export async function POST(request) {
  const auth = await requireCaller(request, ['provider']);
  if (!auth.ok) return auth.response;
  const providerId = auth.caller.id;
  console.log('--- UPLOAD DEBUG START ---');
  const url = new URL(request.url);
  console.log(`📬 [API] Incoming document upload request: ${url.pathname}`);
  try {
    // Parse form data
    const formData = await request.formData();
    const file = formData.get('file');
    const documentType = formData.get('type');

    if (!file || !documentType) {
      return NextResponse.json(
        { success: false, message: 'File and document type required' },
        { status: 400 }
      );
    }

    // Check provider status
    const providers = await execute(
      `SELECT documents_verified FROM service_providers WHERE id = ?`,
      [providerId]
    );

    if (providers[0]?.documents_verified === 1) {
      return NextResponse.json(
        { success: false, message: 'Documents already verified, cannot modify' },
        { status: 403 }
      );
    }

    // Check file type
    const validTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    if (!validTypes.includes(file.type)) {
      return NextResponse.json(
        { success: false, message: 'Invalid file type. Only JPG, PNG, PDF, and DOC are allowed.' },
        { status: 400 }
      );
    }

    // Check file size (5MB limit)
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, message: 'File size too large. Maximum 5MB.' },
        { status: 400 }
      );
    }

    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(process.cwd(), 'public/uploads/providers');
    if (!existsSync(uploadDir)) {
      await mkdir(uploadDir, { recursive: true });
    }

    // 🔥 IMPORTANT: Check if old document exists and delete it
    const oldDocs = await execute(
      `SELECT document_url FROM provider_documents 
       WHERE provider_id = ? AND document_type = ?`,
      [providerId, documentType]
    );

    if (oldDocs.length > 0) {
      const oldUrl = oldDocs[0].document_url;
      // Extract filename from URL
      const oldFilename = oldUrl.split('/').pop();
      const oldPath = path.join(uploadDir, oldFilename);

      // Delete old file if it exists
      try {
        if (existsSync(oldPath)) {
          await unlink(oldPath);
          console.log(`✅ Deleted old file: ${oldFilename}`);
        }
      } catch (deleteError) {
        console.error('Error deleting old file:', deleteError);
        // Continue even if delete fails
      }
    }

    // Generate unique filename with timestamp
    const timestamp = Date.now();
    const extension = file.name.split('.').pop();
    const filename = `${providerId}-${documentType}-${timestamp}.${extension}`;
    const filePath = path.join(uploadDir, filename);

    // Save new file
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    await writeFile(filePath, buffer);

    const fileUrl = `/uploads/providers/${filename}`;

    // Update or insert in database
    if (oldDocs.length > 0) {
      // Update existing record
      await execute(
        `UPDATE provider_documents 
         SET document_url = ?, status = 'pending', is_verified = 0, 
             rejection_reason = NULL, updated_at = NOW()
         WHERE provider_id = ? AND document_type = ?`,
        [fileUrl, providerId, documentType]
      );
    } else {
      // Insert new record
      await execute(
        `INSERT INTO provider_documents 
         (provider_id, document_type, document_url, status, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', NOW(), NOW())`,
        [providerId, documentType, fileUrl]
      );
    }

    // Reset documents_verified flag
    await execute(
      `UPDATE service_providers SET documents_verified = 0 WHERE id = ?`,
      [providerId]
    );

    // Check if all required docs are uploaded
    const requiredDocs = ['id_proof', 'trade_license'];
    const docs = await execute(
      `SELECT document_type FROM provider_documents 
       WHERE provider_id = ? AND document_type IN (?, ?)`,
      [providerId, 'id_proof', 'trade_license']
    );

    const uploadedTypes = docs.map(d => d.document_type);
    const allRequiredUploaded = requiredDocs.every(type => uploadedTypes.includes(type));

    if (allRequiredUploaded) {
      await execute(
        `UPDATE service_providers 
         SET documents_uploaded = 1, 
             onboarding_step = 4 
         WHERE id = ?`,
        [providerId]
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Document uploaded successfully',
      fileUrl: fileUrl,
      documentType: documentType,
      status: 'pending'
    });

  } catch (error) {
    console.error('Document upload error:', error);
    return NextResponse.json(
      { success: false, message: 'Server error: ' + error.message },
      { status: 500 }
    );
  }
}