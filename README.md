# Soil Testing Appointment & Report Access Portal

College-project starter: HTML/CSS/JavaScript frontend, Node.js + Express backend, MySQL database.

## Features implemented
- Responsive public website and six-language switcher (English, Kannada, Hindi, Telugu, Tamil, Marathi; main hero text translated, extend `public/app.js` to translate every label).
- Farmer registration/login; passwords hashed with bcrypt.
- Farmer information stored in MySQL.
- Soil-testing appointment booking and tracking.
- Admin login/dashboard, farmer list, appointment status updates.
- Admin-only PDF report upload; farmer can download only their own report after login.
- Access logs for registration, login, report upload and report access.
- Farmer product listings, admin-managed approved shop directory.
- Sample crop/equipment prices.
- Weather section placeholder (live weather API not connected).

## Install on Windows
1. Install Node.js LTS, MySQL Server, MySQL Workbench, VS Code and Chrome.
2. Open MySQL Workbench, connect to local MySQL, open `database/schema.sql`, execute it.
3. Copy `.env.example` to `.env` in the project root.
4. Edit `.env`: enter your MySQL password, create a long random SESSION_SECRET, and set a unique ADMIN_EMAIL and ADMIN_PASSWORD (12+ characters).
5. In VS Code choose File > Open Folder and open this project.
6. Choose Terminal > New Terminal and run:
   `npm install`
7. Create the first admin:
   `node scripts/create-admin.js`
8. Start the website:
   `npm start`
9. Visit `http://localhost:3000`; admin dashboard: `http://localhost:3000/admin.html`.

## Test the project
1. Register a farmer account on the home page.
2. Log in and book a soil testing appointment.
3. Open `/admin.html` and log in using the admin credentials from `.env`.
4. Change the appointment status and upload a PDF report (max 5 MB).
5. Log back in as the farmer and open My reports to download the report.
6. Add a local shop from the admin dashboard; list a marketplace product as a farmer.

## Hosting later
Push code to a private GitHub repository and deploy the Node.js app to a Node-compatible host (for example Render). Create a managed MySQL database separately, then configure DB connection values and SESSION_SECRET as hosting environment variables. For production, use a persistent session store and private persistent object storage for PDF reports; do not rely on the host's temporary local filesystem. Enable HTTPS, backups, rate limiting, CSRF protection, email verification, password reset and privacy notice before real public use.

## Limitations / honest scope
This is a functional learning prototype, not production-ready. Weather is not live; crop/equipment prices are sample values; nearby shops are admin-entered rather than GPS-based; marketplace has no payment, shipping or order workflow. Report files are kept outside the public folder and access is checked on the server. Do not use real farmer data until security and privacy safeguards are reviewed.
