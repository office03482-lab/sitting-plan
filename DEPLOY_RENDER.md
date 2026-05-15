# Render Deployment Guide

This repo is best deployed on Render as:

- `sitting-plan-backend` -> Render Web Service
- `sitting-plan-frontend` -> Render Static Site
- `sitting-plan-db` -> Render PostgreSQL
- Supabase stays external for auth, storage, and relational data already in use

## What Is Already Prepared

- [render.yaml](./render.yaml) added as a Render blueprint starter
- Backend production start command identified:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

- Frontend build command identified:

```bash
npm install && npm run build
```

## Important Notes

1. Backend production requires `DATABASE_URL`
2. Backend production requires a strong `JWT_SECRET`
3. Frontend also needs Supabase env vars
4. Frontend `/api/*` proxy still needs one manual Render rewrite after backend URL is known

## Backend Service Settings

- Service Type: `Web Service`
- Root Directory: `backend`
- Runtime: `Python`
- Build Command:

```bash
pip install -r requirements.txt
```

- Start Command:

```bash
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

- Health Check Path:

```text
/readyz
```

- Optional Pre-Deploy Command:

```bash
alembic upgrade head
```

## Frontend Service Settings

- Service Type: `Static Site`
- Root Directory: `frontend`
- Build Command:

```bash
npm install && npm run build
```

- Publish Directory:

```text
dist
```

## Required Backend Environment Variables

```env
ENVIRONMENT=production
DEBUG=false
RELOAD=false
HOST=0.0.0.0
DATABASE_URL=<render-postgres-connection-string>
JWT_SECRET=<32+ character strong secret>
CORS_ORIGINS=["https://YOUR_FRONTEND_RENDER_DOMAIN"]
SUPABASE_URL=https://YOUR_PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

## Required Frontend Environment Variables

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=<your-anon-key>
```

## Manual Rewrite You Must Add In Render Static Site

After backend deploys and you know the backend URL, add this rewrite in the frontend static site settings:

- Source:

```text
/api/*
```

- Destination:

```text
https://YOUR_BACKEND_RENDER_DOMAIN/api/*
```

- Action: `Rewrite`

Also keep the SPA fallback:

- Source:

```text
/*
```

- Destination:

```text
/index.html
```

- Action: `Rewrite`

## Recommended Deployment Order

1. Push repo to GitHub
2. Create Render PostgreSQL
3. Deploy backend
4. Set backend env vars
5. Run `alembic upgrade head`
6. Confirm backend `/health` and `/readyz`
7. Deploy frontend
8. Set frontend env vars
9. Add frontend `/api/*` rewrite to backend URL
10. Apply Supabase SQL migrations if not already applied
11. Test login, students, staff, inventory, and photo upload

## Supabase Items To Confirm

- Storage buckets exist:
  - `student-photos`
  - `staff-photos`
- Recent migrations applied:
  - `20260514_009_storage_photo_buckets.sql`
  - `20260514_010_school_scope_indexes.sql`
  - `20260514_011_cleanup_system_staff_rows.sql`

## First Smoke Tests

After deploy:

1. Open frontend URL
2. Try login
3. Open `/api/health` through browser/network flow
4. Check Staff Directory
5. Check Student Management
6. Upload one student photo
7. Upload one staff photo

## Common Failure Causes

- `DATABASE_URL` missing
- `JWT_SECRET` missing or weak
- `CORS_ORIGINS` missing frontend domain
- frontend `/api/*` rewrite not configured
- Supabase env vars missing
- Supabase storage buckets not created
