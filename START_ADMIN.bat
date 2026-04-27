@echo off
echo ============================================
echo    ApRez Admin Tool - Setup & Start
echo ============================================
echo.

cd apps\admin

echo [1/2] Installing dependencies...
call npm install
echo.

echo [2/2] Starting Admin Tool...
echo.
echo ============================================
echo    Admin Tool: http://localhost:3002
echo    Login: admin@aprez.ro / admin123
echo ============================================
echo.
call npx next dev -p 3002
pause
