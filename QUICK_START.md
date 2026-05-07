# Dr. Girish App - Quick Start

## Browser Issues Fixed! 🎉

The browser errors have been resolved. The app now works in offline mode when the backend isn't running.

## To Run the Application:

### Option 1: Automatic Setup (Recommended)
1. Run `install_nodejs.bat` to install Node.js
2. Restart your command prompt
3. Run `run_app.bat` to start both frontend and backend

### Option 2: Manual Setup
1. Install Node.js 18+ from https://nodejs.org/
2. Open command prompt in the project folder
3. Run these commands:

```bash
# Install frontend dependencies
cd frontend
npm install

# Start frontend (in one terminal)
npm run dev

# Start backend (in another terminal)
cd ../backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Access the Application:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000

## Current Status:
- ✅ Frontend works in offline mode
- ✅ No more browser errors
- ✅ Graceful API failure handling
- ✅ All components load properly

The app will show an offline dashboard when the backend isn't connected, and will automatically sync data when the backend becomes available.