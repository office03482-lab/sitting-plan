#!/bin/bash

# Exam Seating Planner - Setup Script
# This script sets up the development environment

set -e

echo "=========================================="
echo "Exam Seating Planner - Development Setup"
echo "=========================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check Python
echo -e "${YELLOW}Checking Python installation...${NC}"
if ! command -v python3 &> /dev/null; then
    echo "Python 3 is not installed. Please install Python 3.10+"
    exit 1
fi
PYTHON_VERSION=$(python3 --version 2>&1 | awk '{print $2}')
echo -e "${GREEN}✓ Python $PYTHON_VERSION found${NC}"
echo ""

# Backend Setup
echo -e "${YELLOW}Setting up Backend...${NC}"
cd backend

# Create venv
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate venv
source venv/bin/activate 2>/dev/null || source venv/Scripts/activate 2>/dev/null

# Install dependencies
echo "Installing Python dependencies..."
pip install -r requirements.txt > /dev/null 2>&1

# Copy .env if not exists
if [ ! -f ".env" ]; then
    echo "Creating .env file from template..."
    cp .env.example .env
    echo "⚠️  Please edit backend/.env with your configuration"
fi

echo -e "${GREEN}✓ Backend setup complete${NC}"
echo ""

# Frontend Setup
echo -e "${YELLOW}Setting up Frontend...${NC}"
cd ../frontend

# Check Node
if ! command -v npm &> /dev/null; then
    echo "Node.js/npm is not installed. Please install Node.js 18+"
    exit 1
fi
NODE_VERSION=$(node --version)
echo -e "${GREEN}✓ Node $NODE_VERSION found${NC}"

# Install dependencies
echo "Installing npm dependencies..."
npm install > /dev/null 2>&1

echo -e "${GREEN}✓ Frontend setup complete${NC}"
echo ""

# Summary
echo "=========================================="
echo "Setup Complete!"
echo "=========================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Configure environment:"
echo "   • Edit backend/.env with database and email settings"
echo ""
echo "2. Start the backend (from backend directory):"
echo "   source venv/bin/activate"
echo "   uvicorn app.main:app --reload"
echo ""
echo "3. Start the frontend (from frontend directory, new terminal):"
echo "   npm run dev"
echo ""
echo "4. Open your browser:"
echo "   Frontend: http://localhost:5173"
echo "   Backend API: http://localhost:8000"
echo "   API Docs: http://localhost:8000/docs"
echo ""
echo "For more details, see START_GUIDE.md"
echo ""
