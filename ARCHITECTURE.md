# Project Architecture & System Design

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    EXAM SEATING PLANNER                          │
│                 Full-Stack Application                           │
└─────────────────────────────────────────────────────────────────┘

┌────────────────────────────────┬────────────────────────────────┐
│     FRONTEND (React)            │     BACKEND (FastAPI)          │
│                                 │                                │
│  Components:                    │  API Routes:                   │
│  • Login/Auth UI                │  • /auth (OTP, JWT)           │
│  • Student Management           │  • /students (CRUD)           │
│  • Room Configuration           │  • /rooms (CRUD)              │
│  • Seating Visualization        │  • /seating (Generate, List)  │
│  • Plan Comparison              │  • /reports (PDF, Excel)      │
│  • Report Export                │  • /exams (CRUD)              │
│                                 │                                │
│  Tech: React 18, TypeScript     │  Tech: FastAPI, SQLAlchemy    │
│  State: Zustand                 │  Validation: Pydantic         │
│  Styling: TailwindCSS           │  Auth: JWT + OTP              │
│  HTTP: Axios                    │  Database: PostgreSQL         │
└────────────────────────────────┴────────────────────────────────┘
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │   DATABASE LAYER         │
                    ├──────────────────────────┤
                    │ PostgreSQL 14+           │
                    │                          │
                    │ Tables:                  │
                    │  • users                 │
                    │  • students              │
                    │  • rooms                 │
                    │  • desks                 │
                    │  • seats                 │
                    │  • exams                 │
                    │  • seating_plans         │
                    │  • activity_logs         │
                    │  • tokens (OTP/reset)    │
                    └──────────────────────────┘

                    ┌──────────────────────────┐
                    │   SERVICES LAYER         │
                    ├──────────────────────────┤
                    │ Business Logic:          │
                    │  • Seating Algorithm     │
                    │  • Excel Processing      │
                    │  • PDF Generation        │
                    │  • Email/OTP             │
                    │  • Validation            │
                    └──────────────────────────┘
```

## Key Components

### 1. **Authentication System**
- Email-based OTP login (no password required)
- JWT token generation and validation
- Role-based access control (Admin, Teacher, Viewer)
- Activity logging for audit trail

### 2. **Student Management**
- Import from Excel with batch classification
- Real-time student data management
- Special needs tracking (wheelchair, extra time, etc.)
- Batch assignment for academic grouping

### 3. **Room Configuration**
- Flexible room setup (customizable dimensions)
- Desk arrangement (2 students per bench)
- Clearance zones (teaching area, aisles)
- Door/window positioning for comfort

### 4. **Anti-Cheat Algorithm (Core Engine)**
- **Plan A (Strict)**: Maximum separation between same batches
  - No same batch on same desk
  - No adjacent desks (all 8 directions)
  - Optimal spread across room
  
- **Plan B (Compact)**: Space-optimized layout
  - Still maintains anti-cheat rules
  - Minimizes empty seats
  - Better utilization for smaller spaces

### 5. **Seating Plan Generation**
- Two alternative plans per room
- Batch distribution balancing
- Automatic validation against rules
- Violation detection and reporting

### 6. **Visualization & Interface**
- SVG-based 2D room diagrams
- Color-coded batches
- Interactive seat selection
- Drag-and-drop manual adjustments
- Real-time validation feedback

### 7. **Report Generation**
- **PDF**: Professional room-wise seating charts
  - Batch identifiers
  - Invigilator instructions
  - Room layout diagrams

- **Excel**: Detailed student-to-seat mapping
  - Student info (name, roll, batch)
  - Seat assignments
  - Room/desk/position details

## Database Schema

```
USERS (Authentication)
├── id, email, phone, full_name, role
├── is_verified, is_active
└── timestamps

STUDENTS (Participant Data)
├── id, roll_number, name, batch
├── email, phone, special_needs
├── requires_near_exit, requires_extra_time
└── school_id (FK)

ROOMS (Physical Space)
├── id, name, school_id
├── dimensions (length, width)
├── desks (num_benches, capacity)
├── clearances (teaching_zone, aisle_width)
├── door_location, features
└── timestamps

DESKS (Individual Seats)
├── id, room_id
├── position (row, col)
├── is_reserved, reservation_reason
└── x_position, y_position

SEATS (Student Positions)
├── id, desk_id
├── position (1 or 2)
├── student_id (FK)
└── is_occupied, is_blocked

SEATING_PLANS (Generated Plans)
├── id, exam_id, room_id
├── name, plan_type (strict/compact)
├── status (draft/reviewed/finalized)
├── validation info, algorithm version
└── timestamps

EXAMS (Exam Events)
├── id, school_id, name
├── subject, exam_date, duration
├── total_students, total_batches
└── timestamps

ACTIVITY_LOGS (Audit Trail)
├── id, user_id
├── action, resource_type, resource_id
├── details, ip_address
└── timestamp
```

## API Flow

### 1. **Login Flow**
```
User Email → Send OTP → Email + OTP Code → Verify OTP → JWT Token
```

### 2. **Student Import Flow**
```
Excel File → Parse & Validate → Check Duplicates → Store in DB → Report
```

### 3. **Room Setup Flow**
```
Room Config → Validate Dimensions → Create Desks & Seats → Store
```

### 4. **Seating Generation Flow**
```
Select Exam & Rooms → Get Students & Room Config → 
Run Algorithm (Plan A & B) → Validate Results → Store Plans → Return
```

### 5. **Plan Finalization Flow**
```
Select Plan → Validate → Update Status → Generate Reports → Export
```

## Deployment Architecture

### Docker Compose Setup
- **Frontend**: React app in Nginx
- **Backend**: FastAPI with Uvicorn
- **Database**: PostgreSQL container
- **Cache**: Redis (optional)

### Environment Variables
```
# Database (PostgreSQL)
DATABASE_URL=postgresql://user:pass@postgres:5432/db

# Security
JWT_SECRET=<random-secure-string>
JWT_EXPIRATION_HOURS=24

# Email
SMTP_EMAIL=<your-email>
SMTP_PASSWORD=<app-password>
SMTP_SERVER=smtp.gmail.com

# Application
PORT=8000
DEBUG=false
RELOAD=false
```

## Data Flow Diagram

```
┌─────────────┐
│   Excel     │──────────────────┐
│  File       │                  │
└─────────────┘                  │
                                 ▼
                            ┌──────────────┐
                            │  API Import  │
                            │  Endpoint    │
                            └──────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌───────────────┐        ┌──────────────┐
            │  Validation   │        │  Database    │
            │  & Parsing    │        │  Storage     │
            └───────────────┘        └──────────────┘
                    │                         ▲
                    └────────────┬────────────┘
                                 │
                            ┌──────────────┐
                            │  Seating     │
                            │  Algorithm   │
                            └──────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌────────────┐            ┌────────────┐
            │  Plan A    │            │  Plan B    │
            │  (Strict)  │            │  (Compact) │
            └────────────┘            └────────────┘
                    │                         │
                    └────────────┬────────────┘
                                 │
                          ┌──────────────┐
                          │  Validation  │
                          │  Rules Check │
                          └──────────────┘
                                 │
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ┌────────────┐            ┌────────────┐
            │   PDF      │            │   Excel    │
            │  Export    │            │  Export    │
            └────────────┘            └────────────┘
```

## Security Features

1. **Authentication**
   - OTP-based login (no password storage)
   - JWT token with expiration
   - Token refresh mechanism

2. **Authorization**
   - Role-based access control
   - Endpoint-level permissions
   - Activity logging

3. **Data Protection**
   - Password hashing (bcrypt)
   - Input validation (Pydantic)
   - CORS configuration
   - Rate limiting (recommended)

4. **Audit Trail**
   - Activity logging
   - User action tracking
   - Timestamp records

## Performance Considerations

1. **Database**
   - Indexes on frequently queried columns
   - Connection pooling
   - Query optimization

2. **Caching**
   - Redis for room layouts
   - Student list caching
   - Plan comparison cache

3. **Frontend**
   - Lazy loading diagrams
   - Efficient state management
   - SVG optimization

4. **API**
   - Async handlers
   - Pagination for large datasets
   - Compression enabled

## Testing Strategy

### Backend Tests
- Unit tests for algorithm
- Integration tests for API
- Database migration tests
- Validation tests

### Frontend Tests
- Component tests
- State management tests
- Integration tests
- E2E tests

## Monitoring & Logging

- Server-side logging
- API request logging
- Database query logging
- Error tracking
- Activity audit logs

## Future Enhancements

1. **Advanced Features**
   - Machine learning for optimal placement
   - Real-time student arrival tracking
   - Mobile app for invigilators
   - SMS notifications

2. **Scalability**
   - Microservices architecture
   - Load balancing
   - Distributed caching
   - Multi-region deployment

3. **Integration**
   - SSO/LDAP integration
   - ERP system integration
   - Proctoring tool integration

---

**System Design**: April 2026 | **Version**: 1.0.0
