# ApRez Admin Tool - Setup Guide

## Quick Start

### Prerequisites
- Node.js 18+ and npm/yarn
- Backend API running at `http://localhost:4000`

### Installation

```bash
# Navigate to the admin directory
cd apps/admin

# Install dependencies
npm install

# Start development server (runs on port 3002)
npm run dev
```

Visit `http://localhost:3002` in your browser.

## Project Structure

```
app/
  ├── layout.js              # Root layout with Tailwind setup
  ├── globals.css            # Tailwind imports and base styles
  ├── page.js                # Home page (redirects to login or dashboard)
  ├── login/
  │   └── page.js            # Admin login page
  └── dashboard/
      ├── layout.js          # Dashboard layout with sidebar navigation
      ├── page.js            # Main dashboard overview
      ├── restaurants/
      │   ├── page.js        # List all restaurants
      │   ├── new/
      │   │   └── page.js    # Create new restaurant
      │   └── [id]/
      │       ├── page.js    # Edit restaurant
      │       └── layout-editor/
      │           └── page.js # Grid table layout editor
      ├── billing/
      │   └── page.js        # Billing overview
      └── team/
          └── page.js        # Team member management

lib/
  └── api.js                 # API helper with JWT auth

Config files:
  ├── next.config.js         # Next.js configuration
  ├── tailwind.config.js     # Tailwind CSS config
  ├── postcss.config.js      # PostCSS config
  └── package.json           # Dependencies and scripts
```

## Features

### 1. Authentication
- Login page with email and password
- JWT token stored in localStorage
- Automatic redirect to login on 401 response
- Auto-logout and redirect functionality

### 2. Dashboard
- Overview cards: Total Restaurants, Reservations, Diners, Revenue, Growth %
- Quick action buttons for common tasks
- All data fetched from `/api/admin/analytics/overview`

### 3. Restaurants Management
- **List View**: Table of all restaurants with status badges
  - Actions: Edit, View Layout, Deactivate/Activate

- **Create Restaurant**: Comprehensive form with:
  - Basic info (names in Romanian & English)
  - Descriptions (Romanian & English)
  - Contact info (address, phone, email, website)
  - Multiple cuisine types (22 options)
  - Opening hours for each day with toggles
  - Service periods (Lunch, Dinner, etc.)
  - Max party size and auto-confirm settings
  - Displays generated credentials on creation

- **Edit Restaurant**: Same form as create, pre-filled
  - Edit Layout button to access grid editor
  - Generate New Credentials button
  - Activate/Deactivate toggle

- **Layout Editor**: Visual grid-based table management
  - Multiple sections per restaurant (Interior, Terrace, etc.)
  - Add/edit sections with custom grid size (rows & columns)
  - Click-to-add tables in grid cells
  - Table details: number and seat count
  - Delete tables with confirmation
  - Visual grid with green highlighting for occupied cells

### 4. Billing
- Table view of all billing records
- Columns: Restaurant, Month, Total Diners, Amount (RON), Payment Status
- Mark unpaid records as paid
- Generate Reports button
- Summary cards: Total Records, Paid, Pending, Total Revenue

### 5. Team Management
- List of admin team members
- Add new team members with email, name, password
- Delete team members with confirmation
- Role badge (Admin)

## API Integration

All API calls go through `/lib/api.js` which:
- Adds base URL: `http://localhost:4000`
- Automatically includes JWT token from localStorage
- Handles 401 (unauthorized) by redirecting to login
- Wraps responses in error handling

### Available Functions
```javascript
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api'

apiGet('/api/endpoint')           // GET request
apiPost('/api/endpoint', body)    // POST request
apiPut('/api/endpoint', body)     // PUT request
apiDelete('/api/endpoint')        // DELETE request
```

## Design System

### Colors
- **Primary Accent**: `#4CAF50` (Green)
- **Sidebar**: `#1a1a2e` (Dark Navy)
- **Background**: Light gray and white
- **Destructive Actions**: Red

### Components
- Cards with shadows and rounded corners
- Tables with alternating row colors
- Forms with proper labels and spacing
- Loading states on all data fetches
- Error messages with red backgrounds
- Success confirmations with modals

## Environment Variables

None required for local development. Backend URL is hardcoded to `http://localhost:4000`.

For production, modify `/lib/api.js` to use:
```javascript
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000'
```

## Browser Requirements
- Modern browser with ES6+ support
- localStorage support for JWT token storage

## Build & Deployment

### Build for Production
```bash
npm run build
npm start
```

### Deployment
The application is a standard Next.js 14 app that can be deployed to:
- Vercel (recommended)
- Docker
- Any Node.js hosting provider

## Notes

- All pages that use hooks or browser APIs have `'use client'` directive
- The app is fully responsive but designed primarily for desktop
- No external UI libraries used (pure Tailwind CSS)
- Token is stored in localStorage (suitable for internal admin tools)
- All API errors are caught and displayed to the user
- Confirm dialogs before destructive actions (delete, deactivate)
