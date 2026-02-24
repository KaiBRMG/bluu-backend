import { NextRequest, NextResponse } from 'next/server';
import { google } from 'googleapis';
import { adminAuth } from '@/lib/firebase-admin';
import { ensureUserExists } from '@/lib/services/userService';

const oauth2Client = new google.auth.OAuth2(
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.NEXT_PUBLIC_REDIRECT_URI || 'http://localhost:3000/auth/callback'
);

export async function POST(request: NextRequest) {
  try {
    const { code } = await request.json();

    if (!code) {
      return NextResponse.json(
        { error: 'Authorization code is required' },
        { status: 400 }
      );
    }

    // Decode the authorization code (it comes URL-encoded from the deep link)
    const decodedCode = decodeURIComponent(code);

    // Exchange authorization code for tokens
    try {
      const { tokens } = await oauth2Client.getToken(decodedCode);
      oauth2Client.setCredentials(tokens);

    // Get user info from Google
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: userInfo } = await oauth2.userinfo.get();

    if (!userInfo.email) {
      return NextResponse.json(
        { error: 'Unable to retrieve user email' },
        { status: 400 }
      );
    }

    // Verify email domain
    if (!userInfo.email.endsWith('@bluurock.com')) {
      return NextResponse.json(
        { error: 'Access denied. Only @bluurock.com emails are allowed.' },
        { status: 403 }
      );
    }

    // Create or get Firebase user
    let firebaseUser;
    try {
      firebaseUser = await adminAuth.getUserByEmail(userInfo.email);
    } catch (error: any) {
      if (error.code === 'auth/user-not-found') {
        // Create new user — do NOT pass photoURL so initials avatar is used
        firebaseUser = await adminAuth.createUser({
          email: userInfo.email,
          displayName: userInfo.name || undefined,
          emailVerified: userInfo.verified_email || false,
        });
      } else {
        throw error;
      }
    }

    // Parallelize database operations and token creation for better performance
    console.time('[Auth] Database operations');
    const [, customToken] = await Promise.all([
      ensureUserExists({
        uid: firebaseUser.uid,
        workEmail: userInfo.email,
        displayName: userInfo.name || '',
      }),
      adminAuth.createCustomToken(firebaseUser.uid),
    ]);
    console.timeEnd('[Auth] Database operations');

      return NextResponse.json({
        customToken,
        user: {
          email: userInfo.email,
          name: userInfo.name,
        },
      });
    } catch (tokenError: any) {
      throw tokenError;
    }
  } catch (error: any) {
    console.error('Error exchanging code:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to exchange authorization code' },
      { status: 500 }
    );
  }
}
