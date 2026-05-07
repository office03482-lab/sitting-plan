# Exam Seating Planner - Development Instructions

## Project Overview
Full-stack exam seating planner with React frontend and FastAPI backend for generating anti-cheat exam seating arrangements.

## Architecture
- **Frontend**: React 18 + TypeScript + Vite + TailwindCSS
- **Backend**: FastAPI + SQLAlchemy + PostgreSQL
- **Auth**: JWT + Email OTP
- **Visualization**: SVG-based interactive 2D room layouts

## Key Files & Responsibilities

### Backend Structure
- `/app/models/` - SQLAlchemy ORM models (User, Student, Room, Seat, Plan, etc.)
- `/app/schemas/` - Pydantic validation schemas
- `/app/routes/` - REST API endpoints (auth, students, rooms, seating, reports)
- `/app/services/` - Business logic (seating algorithm, Excel processing, PDF generation)
- `/app/utils/` - Helper utilities (auth, validation, Excel, PDF)

### Frontend Structure
- `/src/components/` - Reusable React components
- `/src/pages/` - Page components (Dashboard, RoomConfig, SeatingPlan, etc.)
- `/src/services/` - API client and service layer
- `/src/store/` - Zustand state management
- `/src/types/` - TypeScript interfaces and types

## Development Workflow

### 1. Backend Setup
```
cd backend
python -m venv venv
source venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env
alembic upgrade head
uvicorn app.main:app --reload
```

### 2. Frontend Setup
```
cd frontend
npm install
npm run dev
```

### 3. Database Migrations
```
cd backend
alembic revision --autogenerate -m "description"
alembic upgrade head
```

## Key Algorithms

### Anti-Cheat Engine (`backend/app/services/seating_engine.py`)
- Implements checkerboard/staggered pattern distribution
- Ensures 8-way adjacency rules (no same-batch neighbors)
- Maintains minimum 1-meter desk spacing
- Balances batches across all desks

### Plan Generation
- **Plan A**: Strict anti-cheat with maximum separation
- **Plan B**: Optimized compact layout for smaller spaces
- Both respect physical room constraints

## API Endpoints (Key Routes)

### Authentication
- `POST /api/auth/send-otp` - Request OTP
- `POST /api/auth/verify-otp` - Verify and login
- `POST /api/auth/logout` - Logout

### Room Management
- `GET /api/rooms` - List rooms
- `POST /api/rooms` - Create room
- `PUT /api/rooms/{id}` - Update room
- `DELETE /api/rooms/{id}` - Delete room

### Student Management
- `POST /api/students/import` - Upload Excel
- `GET /api/students` - List students
- `PUT /api/students/{id}` - Update student
- `DELETE /api/students/{id}` - Delete student

### Seating Generation
- `POST /api/seating/generate` - Generate both plans
- `GET /api/seating/plans` - List generated plans
- `POST /api/seating/plans/{id}/finalize` - Finalize plan

### Reports
- `GET /api/reports/pdf/{plan_id}` - Export PDF
- `GET /api/reports/excel/{plan_id}` - Export Excel

## Common Tasks

### Add New Endpoint
1. Create schema in `/app/schemas/`
2. Create route in `/app/routes/`
3. Add service logic in `/app/services/`
4. Update docs in API docstring

### Add New Database Model
1. Create model in `/app/models/`
2. Create schema in `/app/schemas/`
3. Create migration: `alembic revision --autogenerate`
4. Apply: `alembic upgrade head`

### Modify Seating Algorithm
1. Edit `/app/services/seating_engine.py`
2. Adjust grid_spacing, adjacency_rules, or batch_distribution logic
3. Update tests in `/tests/`

### Update Frontend Component
1. Edit component in `/src/components/`
2. Update types in `/src/types/`
3. Update associated store in `/src/store/`
4. Test with npm run dev

## Testing

### Backend
```
cd backend
pytest tests/ -v
pytest tests/test_seating_engine.py  # Test algorithm
```

### Frontend
```
cd frontend
npm run test
npm run test:coverage
```

## Deployment

### Docker
```
docker-compose up -d
# Services available at:
# Frontend: http://localhost:3000
# Backend: http://localhost:8000
# DB: postgres://localhost:5432
```

### Environment Variables
Copy `.env.example` to `.env` and configure:
```
DATABASE_URL=postgresql://user:password@localhost:5432/seating_planner
REDIS_URL=redis://localhost:6379/0
JWT_SECRET=your-secret-key
SMTP_EMAIL=notifications@school.edu
```

## Code Style & Standards

### Backend
- Follow PEP8
- Use type hints
- Document functions with docstrings
- Use black for formatting: `black app/`

### Frontend
- Use ESLint and Prettier
- Write functional components with hooks
- Use TypeScript for all new code
- Component files in PascalCase

## Debugging Tips

- **Backend Logs**: Check UVICORN output for route errors
- **Database Issues**: Run `alembic current` to check schema
- **Auth Issues**: Verify JWT_SECRET in .env matches across services
- **CORS**: Check backend CORS settings if frontend requests fail
- **Visualization**: Use browser DevTools to inspect SVG rendering

## Performance Optimization

- Use database indexes on frequently queried columns (batch, room_id)
- Cache room layouts in Redis
- Implement pagination for large student lists
- Lazy-load room diagrams in frontend

## Security Checklist

- ✅ Hash passwords (done by default with SQLAlchemy/bcrypt)
- ✅ Use HTTPS in production
- ✅ Validate all inputs (Pydantic handles this)
- ✅ Implement rate limiting on auth endpoints
- ✅ Regularly rotate JWT secrets
- ✅ Sanitize file uploads (Excel validation)

## Support Resources

- FastAPI Docs: https://fastapi.tiangolo.com/
- SQLAlchemy ORM: https://docs.sqlalchemy.org/
- React Documentation: https://react.dev/
- TailwindCSS: https://tailwindcss.com/

---
**Updated**: April 2026 | **Version**: 1.0.0-setup
