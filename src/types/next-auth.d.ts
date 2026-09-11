import 'next-auth';
import { Permission } from '@/src/lib/auth';

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
