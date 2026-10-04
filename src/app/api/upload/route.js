// app/api/upload/route.js
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { requireCaller } from '@/lib/api-auth';

export async function POST(request) {
  const auth = await requireCaller(request, ['customer', 'provider', 'admin']);
  if (!auth.ok) return auth.response;
  try {
    const formData = await request.formData();
    const file = formData.get('file');
    
    if (!file) {
      return NextResponse.json(
        { success: false, message: 'No file uploaded' },
        { status: 400 }
      );
    }

    // Check file type
    if (!file.type.startsWith('image/')) {
      return NextResponse.json(
        { success: false, message: 'Please upload only image files' },
        { status: 400 }
      );
    }

    // Check file size (10MB limit)
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, message: 'File size exceeds 10MB' },
        { status: 400 }
      );
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    
    // Create uploads directory if it doesn't exist
    const uploadDir = path.join(process.cwd(), 'public/uploads');
    await mkdir(uploadDir, { recursive: true });
    
    // Generate unique filename
    const timestamp = Date.now();
    const originalName = file.name.replace(/[^a-zA-Z0-9.]/g, '_'); // Remove special characters
    const filename = `${timestamp}-${originalName}`;
    const filepath = path.join(uploadDir, filename);
    
    // Save file
    await writeFile(filepath, buffer);
    
    // Return the public URL
    const imageUrl = `/uploads/${filename}`;
    
    return NextResponse.json({
      success: true,
      url: imageUrl,
      message: 'File uploaded successfully'
    });
    
  } catch (error) {
    console.error('Upload error:', error);
    return NextResponse.json(
      { success: false, message: 'Upload failed' },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  const auth = await requireCaller(request, ['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { searchParams } = new URL(request.url);
    const fileUrl = searchParams.get('url');

    if (!fileUrl) {
      return NextResponse.json(
        { success: false, message: 'File URL is required' },
        { status: 400 }
      );
    }

    // Extract filename from URL (assuming URL format is /uploads/filename)
    const filename = fileUrl.split('/').pop();
    if (!filename) {
      return NextResponse.json(
        { success: false, message: 'Invalid file URL' },
        { status: 400 }
      );
    }

    const filepath = path.join(process.cwd(), 'public/uploads', filename);

    const { unlink } = require('fs/promises');
    try {
      await unlink(filepath);
    } catch (fsError) {
      // If file doesn't exist, we can still consider the deletion "successful"
      if (fsError.code !== 'ENOENT') {
        throw fsError;
      }
    }

    return NextResponse.json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Delete upload error:', error);
    return NextResponse.json(
      { success: false, message: 'Failed to delete file' },
      { status: 500 }
    );
  }
}
