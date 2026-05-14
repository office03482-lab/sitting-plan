# Dr. Girish App - Professional Anti-Cheat Examination Seating System

A comprehensive full-stack application for generating optimized, intelligent exam seating plans with advanced anti-cheating mechanisms, multi-room distribution, and interactive visualizations.

## 🚀 Quick Start

### Prerequisites
- **Node.js 18+** (for frontend)
- **Python 3.10+** (for backend)

### One-Click Setup
1. **Install Node.js**: Run `install_nodejs.bat`
2. **Run Complete App**: Run `run_app.bat`

This will automatically:
- ✅ Install all dependencies
- ✅ Set up database with sample data
- ✅ Start backend server (http://localhost:8000)
- ✅ Start frontend (http://localhost:5173)
- ✅ Open browser automatically

## 🎯 Features

### ✅ Core Functionality
- **Smart Student Import**: Import from Excel with Name, Roll Number, Batch, and metadata
- **Room Configuration**: Multiple rooms with customizable dimensions, desk arrangements, and layouts
- **Anti-Cheat Algorithm**: Ensures no same-batch students are adjacent (all 8 directions)
- **Dual Plan Generation**: Strict anti-cheat vs. optimized compact layouts
- **Interactive Visualization**: 2D SVG diagrams with real-time updates and drag-drop editing
- **Multi-Room Optimization**: Auto-distribute students across rooms with batch balancing

### 📊 Advanced Features
- **Real-Time Validation**: Instant rule violation detection
- **Smart Adjustments**: Auto-reassign for absences and last-minute changes
- **Special Needs Support**: Reserved seats for wheelchair access and special requirements
- **Visual Comfort**: Account for glare, light direction, and teacher visibility
- **Dual Plan Comparison**: Visual side-by-side comparison of alternatives

### 👥 Management Modules
- **Student Management**: CRUD operations, bulk import, batch organization
- **Teacher Management**: Staff profiles, subject assignments, contact info
- **Timetable Management**: Schedule creation with conflict detection
- **Dual Management**: Unified interface for teachers and students

### 📤 Export & Reports
- **PDF Export**: Room-wise seating charts with batch identifiers
- **Excel Export**: Student-to-seat mapping with room/bench details
- **Invigilator Instructions**: Per-room setup and supervision guidelines

### ⚙️ Settings & Configuration
- **School Information**: Institution details and branding
- **System Preferences**: Timezone, formats, feature toggles
- **Batch Colors**: Visual customization for different groups
- **Export Options**: PDF/Excel format preferences

### 🔐 Security & Access
- **Email/OTP Authentication**: Secure login system
- **Role-Based Access**: Admin, Teacher, and Viewer roles
- **Activity Logging**: Track all changes and exports
- **Data Protection**: Secure database with encrypted credentials

### 💾 Data Management
- **Save & Reuse**: Store seating plans for future exams
- **Plan History**: Track previous plans and modifications
- **Template Management**: Reusable room and layout templates
- **Emergency Mode**: One-click plan regeneration

## 🏗️ Tech Stack

### Frontend
- **React 18** with TypeScript
- **Vite** for fast development
- **TailwindCSS** for styling
- **SVG Canvas** for 2D room visualization
- **React DnD** for drag-and-drop functionality
- **Zustand** for state management
- **Axios** for API communication

### Backend
- **FastAPI** (Python async framework)
- **SQLAlchemy** ORM with lidation
- **JWT** authentication
- **OpenPyXL** for Excel processing
- **ReportLab** for PDF generation

### Database Schema
- **Schools**: Institution management
- **Students**: Student profiles and batches
- **Teachers**: Staff information
- **Rooms**: Physical space configuration
- **Exams**: Test scheduling
- **Seating Plans**: Generated arrangements
- **Timetable**: Class schedules
- **Settings**: System configuration

## 🎮 How to Use

### 1. Student Management
- **Import Students**: Upload Excel file with student data
- **Manual Entry**: Add individual students
- **Batch Organization**: Group by 11th, 12th, Droppers
- **Special Needs**: Mark accessibility requirements

### 2. Room Configuration
- **Add Rooms**: Define dimensions and desk layouts
- **Door Placement**: Specify entrance locations
- **Capacity Calculation**: Automatic seat counting
- **Visual Preview**: See room layouts

### 3. Teacher & Timetable
- **Add Teachers**: Create staff profiles
- **Schedule Classes**: Set up weekly timetables
- **Conflict Detection**: Automatic overlap prevention
- **Subject Assignment**: Link teachers to subjects

### 4. Seating Generation
- **Select Exam**: Choose test and room
- **Choose Algorithm**: Plan A (strict) or Plan B (compact)
- **Generate Plan**: AI-powered seat assignment
- **Visual Review**: Interactive seating chart
- **Export Results**: PDF/Excel reports

### 5. Settings
- **School Info**: Configure institution details
- **Preferences**: Set timezone, formats, colors
- **Feature Toggles**: Enable/disable system features
- **Data Management**: Backup and reset options

## 🔧 API Reference

### Authentication
```
POST /api/auth/send-otp     - Request login OTP
POST /api/auth/verify-otp   - Verify and login
POST /api/auth/logout       - Logout
```

### Students
```
POST /api/students/import   - Bulk import from Excel
GET  /api/students          - List students
POST /api/students          - Add student
PUT  /api/students/{id}     - Update student
DELETE /api/students/{id}   - Delete student
```

### Rooms
```
GET  /api/rooms             - List rooms
POST /api/rooms             - Create room
PUT  /api/rooms/{id}        - Update room
DELETE /api/rooms/{id}      - Delete room
```

### Seating
```
POST /api/seating/generate  - Generate plans
GET  /api/seating/plans     - List plans
POST /api/seating/plans/{id}/finalize - Finalize plan
```

### Reports
```
GET /api/reports/pdf/{plan_id}   - PDF export
GET /api/reports/excel/{plan_id} - Excel export
```

## 🎨 Anti-Cheat Algorithm

The intelligent seating system uses advanced algorithms:

1. **8-Way Adjacency Check**: Prevents same-batch students from sitting in any of 8 directions
2. **Batch Distribution**: Ensures even distribution across all batches
3. **Room Optimization**: Balances security with space utilization
4. **Special Accommodations**: Reserves seats for special needs
5. **Visual Comfort**: Considers lighting and teacher visibility
6. **Emergency Adjustments**: Quick reassignments for absences

## 📊 Sample Data Included

- **20+ Students**: Across 11th, 12th, and Dropper batches
- **5 Classrooms**: Various sizes and configurations
- **8 Teachers**: Different subjects and schedules
- **Complete Timetable**: Weekly class schedules
- **Pre-generated Plans**: Example seating arrangements

## 🔍 Troubleshooting

### App Won't Start
- Run `install_nodejs.bat` first
- Restart command prompt after Node.js installation
- Check if ports 5173 and 8000 are available

### Backend Issues
- Ensure Python virtual environment is activated
- Check if all pip packages are installed
- Verify database file exists

### Frontend Issues
- Clear browser cache
- Check browser console for errors
- Ensure Node.js is in system PATH

### Import Problems
- Use provided Excel template
- Check for duplicate roll numbers
- Verify all required columns exist

## 📞 Support

- **API Documentation**: http://localhost:8000/docs
- **Frontend**: http://localhost:5173
- **Logs**: Check backend terminal for errors
- **Database**: PostgreSQL database (via Doc
## 🔄 Development

### Backend
```bash
cd backend
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

### Database Reset
```bash
# Run setup script
setup_database.bat
```

---

**Version**: 1.0.0 | **Status**: Production Ready
**Last Updated**: April 12, 2026
- **Python 3.10+**
- **FastAPI** for REST API
- **SQLAlchemy** with PostgreSQL
- **Pydantic** for data validation
- **JWT** for authentication
- **Openpyxl** for Excel processing
- **ReportLab** for PDF generation
- **APScheduler** for task scheduling

### Database
- **PostgreSQL 14+** (primary data store)
- **Redis** (optional, for caching and session management)

## Project Structure

```
exam-seating-planner/
├── frontend/                    # React TypeScript SPA
│   ├── src/
│   │   ├── components/         # Reusable UI components
│   │   ├── pages/              # Page components
│   │   ├── services/           # API service layer
│   │   ├── store/              # Zustand state management
│   │   ├── hooks/              # Custom React hooks
│   │   ├── types/              # TypeScript types
│   │   ├── utils/              # Utility functions
│   │   └── App.tsx
│   ├── public/
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
├── backend/                     # FastAPI application
│   ├── app/
│   │   ├── models/             # SQLAlchemy ORM models
│   │   ├── schemas/            # Pydantic request/response schemas
│   │   ├── routes/             # API endpoints
│   │   ├── services/           # Business logic & algorithms
│   │   ├── utils/              # Utilities (auth, excel, pdf, etc.)
│   │   ├── middleware/         # Authentication, logging
│   │   ├── config.py           # Configuration
│   │   ├── database.py         # Database setup
│   │   └── main.py             # FastAPI app entry point
│   ├── migrations/             # Alembic database migrations
│   ├── tests/                  # Unit and integration tests
│   ├── requirements.txt        # Python dependencies
│   ├── .env.example            # Environment variables template
│   └── Dockerfile              # Docker configuration
│
├── .github/
│   ├── copilot-instructions.md # Copilot instructions
│   └── workflows/              # GitHub Actions CI/CD
│
├── docker-compose.yml          # Multi-container setup
├── .gitignore
├── .env.example
└── README.md
```

## Installation & Setup

### Prerequisites
- **Python 3.10+**
- **Node.js 18+** and npm
- **PostgreSQL 14+**
- **Redis** (optional)

### Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
source venv/Scripts/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your database credentials

# Run migrations
alembic upgrade head

# Start server
uvicorn app.main:app --reload
```

Server runs on `http://localhost:8000`

### Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

Frontend runs on `http://localhost:5173`

### Using Docker Compose

```bash
# Start all services
docker-compose up -d

# Access services:
# Frontend: http://localhost:3000
# Backend: http://localhost:8000
# PostgreSQL: localhost:5432
```

## Quick Start

1. **Login**: Use email/OTP to authenticate
2. **Import Students**: Upload Excel file with student data
3. **Configure Rooms**: Define room dimensions and desk arrangements
4. **Generate Plans**: Generate Plan A (strict) and Plan B (compact)
5. **Review & Edit**: Adjust seats using interactive visualization
6. **Export**: Download PDF or Excel reports
7. **Save**: Store plans for future reference

## API Documentation

Once backend is running:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Configuration

### Room Configuration Example

```json
{
  "name": "Class A Hall",
  "length_feet": 30,
  "width_feet": 20,
  "desk_length_feet": 2,
  "desk_width_feet": 3,
  "num_benches": 15,
  "teaching_zone_clearance_feet": 5,
  "aisle_width_feet": 3,
  "door_location": "left"
}
```

### Anti-Cheat Algorithm Rules

1. **No Same Batch**: Students from same batch cannot sit on same bench
2. **Adjacent Rule**: No same-batch students within ±1 desk in any direction (8-way adjacency)
3. **Minimum Distance**: ~1 meter (3 feet) between desk centers
4. **Batch Distribution**: Balanced distribution across all desks
5. **Multi-Room Balance**: Even batch distribution across rooms

## Development Notes

- Backend uses **FastAPI** with async support for high performance
- Database migrations use **Alembic** for version control
- Frontend uses **React hooks** and Zustand for state management
- SVG-based room layouts render efficiently without external dependencies
- All algorithms are optimized for schools with 100-2000+ students

## Testing

```bash
# Backend tests
cd backend
pytest tests/

# Frontend tests
cd frontend
npm run test
```

## Contributing

1. Follow PEP8 (backend) and ESLint (frontend) standards
2. Write tests for new features
3. Update documentation
4. Commit with clear messages

## License

Proprietary - School Exam Management System

## Support

For issues, feature requests, or questions:
- Create an issue in the repository
- Contact the development team

---

**Version**: 1.0.0 | **Last Updated**: April 2026
