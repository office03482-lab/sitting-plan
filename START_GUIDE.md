START_GUIDE.md

# Quick Start Guide - Dr. Girish App

## Prerequisites

- Python 3.10+
- Node.js 18+
- PostgreSQL 14+
- Redis (optional)

## Option 1: Docker (Recommended)

### Setup & Run

```bash
# 1. Navigate to project root
cd "SITTING PLAN"

# 2. Create .env file in backend
cp backend/.env.example backend/.env

# 3. Edit backend/.env with your configuration
# At minimum, set JWT_SECRET

# 4. Start all services
docker-compose up -d

# 5. Access services:
# Frontend: http://localhost:3000
# Backend API: http://localhost:8000
# API Docs: http://localhost:8000/docs
```

## Option 2: Local Development

### Backend Setup

```bash
# 1. Navigate to backend
cd backend

# 2. Create virtual environment
python -m venv venv

# 3. Activate virtual environment
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

# 4. Install dependencies
pip install -r requirements.txt

# 5. Create .env file
cp .env.example .env

# 6. Configure .env
# Edit .env and set:
# - DATABASE_URL: Your PostgreSQL connection
# - JWT_SECRET: A secure random string
# - SMTP credentials (for email notifications)

# 7. Run database migrations
alembic upgrade head

# 8. Start development server
uvicorn app.main:app --reload

# Backend runs on http://localhost:8000
```

### Frontend Setup

```bash
# 1. Open new terminal
cd frontend

# 2. Install dependencies
npm install

# 3. Start development server
npm run dev

# Frontend runs on http://localhost:5173
```

## First Login

### Step 1: Send OTP
1. Go to http://localhost:5173 (or http://localhost:3000)
2. Enter your email address
3. Click "Send OTP"

### Step 2: Verify OTP
```
Note: In development mode without email configured,
check the backend logs for the OTP code.

For production, configure SMTP settings in .env
```

4. Enter the OTP code
5. Click "Verify OTP"

## Initial Setup Workflow

### 1. Import Students

1. Go to **Dashboard** → **Import Students**
2. Prepare an Excel file with columns:
   - Name (required)
   - Roll Number (required)
   - Batch (required) - values: 11th, 12th, Dropper 1-10
   - Email (optional)
   - Phone (optional)
   - Special Needs (optional)
3. Upload the file
4. Verify import statistics

### 2. Configure Rooms

1. Go to **Dashboard** → **Configure Rooms**
2. Click **Add Room**
3. Enter room details:
   - **Name**: Room A, Class 1, etc.
   - **Dimensions**: Length × Width in feet
   - **Number of Benches**: Total desks (2 students per desk)
   - **Desk Size**: Standard 2ft × 3ft
   - **Teaching Zone**: Clearance from board (usually 5ft)
   - **Aisle Width**: Space for invigilator (usually 3ft)
   - **Special Needs**: If wheelchair accessible
4. Click **Save**

### 3. Generate Seating Plans

1. Go to **Dashboard** → **Generate Plans**
2. Select:
   - **Exam**: Choose exam (if not listed, create one)
   - **Rooms**: Select rooms to generate for
3. Click **Generate Plans**
4. System creates:
   - **Plan A**: Strict anti-cheat with maximum separation
   - **Plan B**: Optimized compact layout
5. Review both plans

### 4. Review & Compare Plans

1. Go to **Dashboard** → **Compare Plans**
2. View **Plan A** and **Plan B** side-by-side
3. Compare:
   - Batch distribution
   - Desk utilization
   - Anti-cheat violations
4. Select preferred plan

### 5. Finalize & Export

1. Click **Finalize Plan**
2. Export as:
   - **PDF**: Room-wise seating chart (distribute to invigilators)
   - **Excel**: Detailed student-to-seat mapping
3. Optional: Send details to students via email

## Important Features

### Anti-Cheat Rules Enforced

✅ No same-batch students on same bench
✅ No same-batch students adjacent (all 8 directions)
✅ Minimum 1-meter spacing between desks
✅ Balanced batch distribution across rooms
✅ Smart desk utilization

### Supported Batches

- 11th Standard
- 12th Standard
- Dropper 1 through Dropper 10

### Special Features

- **Real-Time Validation**: See rule violations instantly
- **Manual Editor**: Drag-and-drop seat adjustments
- **Quick Regenerate**: One-click replanning if needed
- **Absence Handling**: Mark students absent and auto-reassign
- **Accessibility**: Reserve seats for special needs students

## API Documentation

### Access API Docs

```
Swagger UI: http://localhost:8000/docs
ReDoc: http://localhost:8000/redoc
```

### Key Endpoints

**Authentication**
- `POST /api/auth/send-otp` - Request OTP
- `POST /api/auth/verify-otp` - Login with OTP

**Students**
- `POST /api/students/import` - Import from Excel
- `GET /api/students` - List students
- `PUT /api/students/{id}` - Update student
- `DELETE /api/students/{id}` - Delete student

**Rooms**
- `POST /api/rooms` - Create room
- `GET /api/rooms` - List rooms
- `PUT /api/rooms/{id}` - Update room
- `DELETE /api/rooms/{id}` - Delete room

**Seating**
- `POST /api/seating/generate` - Generate plans
- `GET /api/seating/plans/{room_id}` - List plans
- `GET /api/seating/{plan_id}/layout` - Get layout
- `POST /api/seating/{plan_id}/finalize` - Finalize plan

**Reports**
- `GET /api/reports/pdf/{plan_id}` - Export PDF
- `GET /api/reports/excel/{plan_id}` - Export Excel

## Troubleshooting

### Database Connection Error

```
Error: could not translate host name "postgres" to address

Solution:
- Ensure PostgreSQL is running
- Check DATABASE_URL in .env
- Verify username/password
```

### OTP Not Sent

```
Error: Failed to send OTP

Solution:
- Check SMTP configuration in .env
- For testing, check backend logs for OTP code
- Ensure email address is valid
```

### Port Already in Use

```
Error: Address already in use

Solution:
# Backend (port 8000)
lsof -i :8000
kill -9 <PID>

# Frontend (port 5173)
lsof -i :5173
kill -9 <PID>

# Or use docker-compose ps and stop services
```

### Database Migrations Failed

```
Solution:
cd backend
alembic current  # Check current version
alembic downgrade -1  # Rollback
alembic upgrade head  # Migrate again
```

## Environment Variables Reference

### Backend (.env)

```
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/seating_planner

# Redis
REDIS_URL=redis://localhost:6379/0

# JWT
JWT_SECRET=your-random-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# Email
SMTP_EMAIL=your-email@gmail.com
SMTP_PASSWORD=your-app-password
SMTP_SERVER=smtp.gmail.com
SMTP_PORT=587

# Server
HOST=0.0.0.0
PORT=8000
DEBUG=True
RELOAD=True

# File Upload
MAX_UPLOAD_SIZE_MB=50
UPLOAD_DIRECTORY=uploads
```

## Development Tips

### Code Organization

```
backend/
├── app/models/       # Database models
├── app/schemas/      # Pydantic validators
├── app/routes/       # API endpoints
├── app/services/     # Business logic
├── app/utils/        # Helpers (auth, excel, pdf)
│   └── seating_engine.py  # Core algorithm
└── app/main.py       # FastAPI app

frontend/
├── src/components/   # Reusable UI components
├── src/pages/        # Page components
├── src/services/     # API client
├── src/store/        # Zustand state
├── src/types/        # TypeScript interfaces
└── src/App.tsx       # Main app component
```

### Running Tests

```bash
# Backend
cd backend
pytest tests/ -v

# Specific test
pytest tests/test_seating_engine.py::test_strict_plan_generation -v

# Frontend
cd frontend
npm run test
npm run test:coverage
```

### Code Formatting

```bash
# Backend - PEP8
cd backend
black app/
flake8 app/

# Frontend - Prettier
cd frontend
npm run lint
npm run format
```

## Next Steps

1. ✅ Install and run via Docker or locally
2. ✅ Create your first exam
3. ✅ Import student data
4. ✅ Configure rooms
5. ✅ Generate seating plans
6. ✅ Export and distribute to invigilators

## Support & Documentation

- **FastAPI Docs**: https://fastapi.tiangolo.com/
- **React Docs**: https://react.dev/
- **PostgreSQL Docs**: https://www.postgresql.org/docs/
- **API Docs**: Available at http://localhost:8000/docs

## License

This project is proprietary and confidential.

---

**Version**: 1.0.0 | **Last Updated**: April 2026
