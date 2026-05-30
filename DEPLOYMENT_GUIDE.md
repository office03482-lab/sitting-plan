# DEPLOYMENT GUIDE

## Dr. Girish App - School ERP System

---

## 1. PREREQUISITES

- Python 3.11+
- Node.js 18+
- PostgreSQL 15+
- Redis 7+ (optional, for rate limiting)
- Render.com account (or any Docker host)

---

## 2. ENVIRONMENT VARIABLES

### Backend (`backend/.env`)

```bash
# Environment
ENVIRONMENT=production
DEBUG=false
RELOAD=false

# Server
HOST=0.0.0.0
PORT=8000

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@host:5432/seating_planner

# Redis (optional)
REDIS_URL=redis://localhost:6379/0

# JWT
JWT_SECRET=<generate with: python -c "import secrets; print(secrets.token_urlsafe(64))">
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRATION_MINUTES=15
REFRESH_TOKEN_EXPIRATION_DAYS=14

# Rate Limiting
LOGIN_MAX_ATTEMPTS=5
LOGIN_IP_MAX_ATTEMPTS=12
OTP_SEND_MAX_ATTEMPTS=5
OTP_VERIFY_MAX_ATTEMPTS=5
AUTH_LOCKOUT_MINUTES=15

# Supabase (if using native services)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=<anon-key>
SUPABASE_JWT_SECRET=<jwt-secret>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
USE_SUPABASE_NATIVE_SERVICES=true

# SMTP (for OTP emails)
SMTP_EMAIL=noreply@school.edu
SMTP_PASSWORD=<app-password>
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587

# CORS
CORS_ORIGINS=https://your-frontend.onrender.com,https://your-custom-domain.com

# File Upload
MAX_UPLOAD_SIZE_MB=50

# Initial Admin (first-time setup)
INITIAL_ADMIN_ENABLED=true
INITIAL_ADMIN_EMAIL=admin@school.edu
INITIAL_ADMIN_USERNAME=admin
INITIAL_ADMIN_PASSWORD=<secure-password>
INITIAL_ADMIN_FULL_NAME=System Administrator
```

### Frontend (`frontend/.env`)

```bash
VITE_API_URL=https://your-backend.onrender.com/api
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=<anon-key>
```

---

## 3. RENDER DEPLOYMENT

### Backend (Web Service)

**Render YAML** (`render.yaml`):
```yaml
services:
  - type: web
    name: sitting-plan-backend
    env: python
    buildCommand: pip install -r requirements.txt
    startCommand: gunicorn app.main:app -k uvicorn.workers.UvicornWorker --bind 0.0.0.0:$PORT
    healthCheckPath: /health
    envVars:
      - key: ENVIRONMENT
        value: production
      - key: JWT_SECRET
        generateValue: true
      - key: DATABASE_URL
        fromDatabase:
          name: sitting-plan-db
          property: connectionString
```

### Frontend (Static Site)

```yaml
  - type: web
    name: sitting-plan-frontend
    env: static
    buildCommand: cd frontend && npm install && npm run build
    staticPublishPath: frontend/dist
    envVars:
      - key: VITE_API_URL
        value: https://sitting-plan-backend.onrender.com/api
```

### Database

```yaml
databases:
  - name: sitting-plan-db
    databaseName: seating_planner
    user: seating_planner_user
    plan: starter
```

---

## 4. DOCKER DEPLOYMENT

### Build and Run

```bash
# Build
docker-compose build

# Run
docker-compose up -d

# Check logs
docker-compose logs -f app
```

### Docker Compose (`docker-compose.yml`)

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "8000:8000"
    env_file:
      - .env
    depends_on:
      - postgres
      - redis
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s
      timeout: 10s
      retries: 3

  postgres:
    image: postgres:15
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: seating_planner
      POSTGRES_USER: seating_planner
      POSTGRES_PASSWORD: ${DB_PASSWORD}

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

volumes:
  postgres_data:
```

---

## 5. CI/CD PIPELINE

### GitHub Actions (`.github/workflows/ci.yml`)

```yaml
name: CI/CD Pipeline

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Backend lint
        run: |
          cd backend
          pip install ruff
          ruff check app/
      - name: Frontend lint
        run: |
          cd frontend
          npm install
          npm run lint

  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Backend tests
        run: |
          cd backend
          pip install -r requirements.txt
          python -m pytest tests/ -v --cov=app --cov-report=term
      - name: Frontend tests
        run: |
          cd frontend
          npm install
          npm test -- --coverage

  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Build backend
        run: docker build -t sitting-plan-backend .
      - name: Build frontend
        run: |
          cd frontend
          npm install
          npm run build

  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run safety check
        run: |
          cd backend
          pip install safety
          safety check -r requirements.txt
      - name: Run npm audit
        run: |
          cd frontend
          npm audit --audit-level=high
```

---

## 6. HEALTH CHECKS

| Endpoint | Purpose | Expected Response |
|----------|---------|-------------------|
| `/health` | Basic liveness | `{"status": "ok"}` |
| `/readyz` | Readiness (DB check) | `{"status": "ready"}` |

---

## 7. MONITORING

- **Application logs**: All logs output to stdout (captured by Render)
- **Error tracking**: Error ID returned in 500 responses for correlation
- **Database metrics**: Monitor via Supabase dashboard
- **Rate limiting**: Configurable via env vars, logs throttled events

---

## 8. SECURITY CHECKLIST

- [ ] JWT_SECRET is at least 64 chars, generated via `secrets.token_urlsafe(64)`
- [ ] DATABASE_URL uses strong credentials
- [ ] SUPABASE_SERVICE_ROLE_KEY is stored in Render secrets, not .env
- [ ] SMTP_PASSWORD is an app-specific password
- [ ] CORS_ORIGINS is set to specific frontend domain
- [ ] DEBUG is false in production
- [ ] RELOAD is false in production
- [ ] Database backups are configured
- [ ] SSL/TLS is enforced (Render provides this by default)
- [ ] Initial admin is disabled after first setup
