# Local Hosting Setup Guide for UAT

## Quick Start (5 steps)

```bash
# 1. Navigate to project
cd /home/user/easynet-finance-ai

# 2. Install dependencies (already done)
npm install

# 3. Generate Prisma client
npx prisma generate

# 4. Create database and push schema
npx prisma db push

# 5. Seed with sample data (optional)
npx tsx prisma/seed.ts

# 6. Start development server
npm run dev
```

Then open **http://localhost:3000** in your browser.

---

## Detailed Setup Instructions

### Prerequisites

You have:
- ✅ Node.js v22.22.3
- ✅ npm 10.9.8

### Step-by-Step

#### 1. Install Dependencies
```bash
cd /home/user/easynet-finance-ai
npm install
```
This installs all packages. Already completed - node_modules exists.

#### 2. Generate Prisma Client
```bash
npx prisma generate
```
This creates the Prisma Client that your app uses to talk to the database.

#### 3. Create Database
```bash
npx prisma db push
```
This creates `prisma/dev.db` (SQLite file) with all tables defined in schema.prisma.

#### 4. Seed Sample Data (Optional but Recommended for UAT)
```bash
npx tsx prisma/seed.ts
```
This populates the database with sample data:
- Default chart of accounts
- Sample customers and suppliers
- Test users with different roles
- Inventory items

#### 5. Start the Application
```bash
npm run dev
```

The app will be available at: **http://localhost:3000**

---

## Important Notes

### Database Location
- SQLite database file: `/home/user/easynet-finance-ai/prisma/dev.db`
- This is a single file - easy to backup, copy, or delete

### Resetting the Database
To start fresh:
```bash
# Delete the database
rm prisma/dev.db

# Re-create and push schema
npx prisma db push

# Re-seed if needed
npx tsx prisma/seed.ts
```

### Environment Variables
The `.env` file at `/home/user/easynet-finance-ai/.env` contains:
```env
DATABASE_URL="file:./dev.db"
NEXTAUTH_SECRET="local-dev-secret-change-in-production-min-32-chars"
NEXTAUTH_URL="http://localhost:3000"
```

No changes needed for local UAT.

### Running in Background
To keep the server running after closing terminal:
```bash
npm run dev &
```
Or use a process manager like PM2 for production-like setup.

### Stopping the Server
Press `Ctrl+C` in the terminal where it's running.

---

## Accessing the Application

| What | URL |
|------|-----|
| Application | http://localhost:3000 |
| API (same origin) | http://localhost:3000/api/* |

---

## Troubleshooting

### Port 3000 Already in Use
```bash
# Run on different port
PORT=3001 npm run dev
```
Then access at http://localhost:3001

### Prisma Generate Fails
```bash
# Clear cache and retry
rm -rf node_modules/.prisma
npx prisma generate
```

### Database Errors
```bash
# Delete and recreate
rm prisma/dev.db
npx prisma db push
```

### Can't Access localhost:3000
- Check if server is running (look for "ready - started server on 0.0.0.0:3000")
- Check firewall settings (should allow localhost connections)
- Try http://127.0.0.1:3000 instead

---

## Project Structure Overview

```
easynet-finance-ai/
├── prisma/
│   ├── schema.prisma      # Database schema (SQLite)
│   ├── dev.db             # SQLite database file (created on first push)
│   └── seed.ts            # Sample data seeder
├── src/                   # Application source code
│   ├── app/               # Next.js app router pages
│   │   ├── dashboard/     # Dashboard page
│   │   ├── customers/     # Customers pages
│   │   ├── invoices/      # Invoices pages
│   │   ├── ...            # Other module pages
│   ├── lib/               # Core libraries
│   │   ├── db.ts          # Prisma client singleton
│   │   ├── auth/          # Authentication logic
│   │   └── ...
│   └── components/        # React components
├── app/                   # Standalone app (if exists)
├── package.json           # Dependencies and scripts
├── .env                   # Environment variables
├── next.config.ts         # Next.js configuration
└── tsconfig.json          # TypeScript configuration
```

---

## Available npm Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Build for production |
| `npm run start` | Start production server (after build) |
| `npx prisma generate` | Generate Prisma Client |
| `npx prisma db push` | Push schema to database |
| `npx prisma db migrate` | Create migration (alternative to push) |
| `npx prisma studio` | Open Prisma GUI database browser |
| `npx tsx prisma/seed.ts` | Seed database with sample data |
| `npm run lint` | Run ESLint |

---

## UAT Testing Tips

1. **Use multiple browser tabs** - One for app, one for this guide
2. **Test with different user roles** - Login as different seeded users
3. **Take screenshots** - Document any issues you find
4. **Try edge cases** - Empty fields, invalid data, rapid clicks
5. **Check network tab** - Open browser DevTools (F12) to see API calls

---

## Support

If you encounter issues:

1. Check this guide first
2. Look at project README.md
3. Check UAT-TEST-GUIDE.md for test scenarios
4. Review console errors in browser DevTools
5. Check terminal output for server errors

---

*For local UAT testing only. Not for production use.*
