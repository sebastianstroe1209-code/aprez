@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ============================================
echo    ApRez - Push to GitHub
echo ============================================
echo.

REM Check git is installed
git --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Git is not installed.
    echo Install it from https://git-scm.com/download/win then run this again.
    pause
    exit /b 1
)
echo [OK] Git is installed.
echo.

REM Configure identity (idempotent)
git config --global user.name "Sebastian Stroe"
git config --global user.email "sebastian.stroe1209@gmail.com"
echo [OK] Git identity configured.
echo.

REM Init repo if not already a valid repo
git rev-parse --git-dir >nul 2>&1
if errorlevel 1 (
    if exist ".git" (
        echo [1/5] Found a broken .git folder — removing it and starting fresh...
        rmdir /s /q ".git"
    )
    echo [1/5] Initializing new git repository...
    git init
    git branch -M main
) else (
    echo [1/5] Git repo already initialized — skipping.
)
echo.

REM Stage everything
echo [2/5] Staging files (this respects .gitignore)...
git add .
echo.

echo [3/5] Files about to be committed:
git status --short
echo.

REM Sanity: warn if any .env is staged
git status --short | findstr /R /C:"\.env$" >nul
if not errorlevel 1 (
    echo.
    echo WARNING: A .env file is staged. This may contain secrets.
    echo Press Ctrl+C to abort, or any key to continue anyway.
    pause >nul
)

REM Commit (skip if nothing to commit)
git diff --cached --quiet
if errorlevel 1 (
    echo [4/5] Committing...
    git commit -m "chore: initial commit of ApRez monorepo"
) else (
    echo [4/5] Nothing new to commit — skipping.
)
echo.

REM Add remote if missing
git remote get-url origin >nul 2>&1
if errorlevel 1 (
    echo Adding GitHub remote...
    git remote add origin https://github.com/sebastianstroe1209-code/aprez.git
) else (
    echo Remote 'origin' already exists.
)
echo.

REM Push
echo [5/5] Pushing to GitHub...
echo If a sign-in window pops up, sign in with your GitHub account.
echo.
git push -u origin main

echo.
echo ============================================
if errorlevel 1 (
    echo    Push failed. Copy the error above and send it to Claude.
) else (
    echo    Done! Refresh https://github.com/sebastianstroe1209-code/aprez
)
echo ============================================
echo.
pause
