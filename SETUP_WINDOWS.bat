@echo off
echo ============================================
echo    ApRez - Setup Script for Windows
echo ============================================
echo.

echo [1/5] Checking Node.js installation...
node --version
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed. Please install it from https://nodejs.org
    pause
    exit /b 1
)
echo Node.js found!
echo.

echo [2/5] Installing server dependencies...
cd server
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    pause
    exit /b 1
)
echo Dependencies installed!
echo.

echo [3/5] Setting up database schema...
call npx prisma generate
call npx prisma db push
if %errorlevel% neq 0 (
    echo ERROR: Failed to set up database
    pause
    exit /b 1
)
echo Database schema created!
echo.

echo [4/5] Seeding database with demo data...
call node prisma/seed.js
echo.

echo [5/5] Starting ApRez server...
echo.
echo ============================================
echo    ApRez server is starting!
echo    API: http://localhost:4000
echo    Health check: http://localhost:4000/api/health
echo ============================================
echo.
echo Login credentials:
echo   Admin:      admin@aprez.ro / admin123
echo   Restaurant: lamama / lamama123
echo   User:       demo@aprez.ro / user123
echo.
call npx nodemon src/index.js
pause
