/**
 * NextAuth.js v5 Configuration
 * Authentication with role-based access control
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import Google from 'next-auth/providers/google';
import { prisma } from './prisma';
import { verifyPassword, ROLE_PERMISSIONS, PERMISSIONS, type Permission } from './auth';
import { generateSecret } from './auth';

// Environment variable validation
const authSecret = process.env.AUTH_SECRET;
if (!authSecret) {
  console.warn('AUTH_SECRET not set. Generate one with: openssl rand -base64 32');
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    // Credentials provider for email/password
    Credentials({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        const email = credentials.email as string;
        const password = credentials.password as string;

        // Find user
        const user = await prisma.user.findUnique({
          where: { email: email.toLowerCase() },
          include: {
            accounts: true,
            sessions: true,
          },
        });

        if (!user) {
          return null;
        }

        // Check if user has password (credentials login)
        if (!user.password) {
          // OAuth user - can't login with credentials
          return null;
        }

        // Check user status
        if (user.status !== 'ACTIVE') {
          return null;
        }

        // Verify password
        const isValid = await verifyPassword(password, user.password);
        if (!isValid) {
          return null;
        }

        // Update last login
        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // Return user with role and permissions
        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          permissions: ROLE_PERMISSIONS[user.role] || [],
          image: user.image,
        };
      },
    }),

    // Google OAuth (optional - configure in production)
    ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      ? [
          Google({
            clientId: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            authorization: {
              params: {
                access_type: 'offline',
                prompt: 'consent',
              },
            },
          }),
        ]
      : []),
  ],

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role: string }).role;
        token.permissions = (user as { permissions: Permission[] }).permissions;
      }
      return token;
    },

    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as string;
        session.user.permissions = token.permissions as Permission[];
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login',
    newUser: '/onboarding',
  },

  session: {
    strategy: 'jwt',
    maxAge: 12 * 60 * 60, // 12 hours
    updateAge: 24 * 60 * 60, // 24 hours
  },

  cookies: {
    sessionToken: {
      name: 'easynet_session_token',
      options: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.NODE_ENV === 'production',
      },
    },
  },

  debug: process.env.NODE_ENV === 'development',
});

// Extend NextAuth types
declare module 'next-auth' {
  interface User {
    role?: string;
    permissions?: Permission[];
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string;
      image?: string;
      role: string;
      permissions: Permission[];
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: string;
    permissions?: Permission[];
  }
}
