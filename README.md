# AI Interview Portal (Node.js + Express + SQLite + Claude)

## Run
    npm install
    cp .env.example .env     # set ANTHROPIC_API_KEY, SMTP_*, JWT_SECRET, admin login
    npm start                # http://localhost:3000

Admin login = ADMIN_EMAIL / ADMIN_PASSWORD from `.env`.
Without SMTP settings, emails (credentials, schedule, offer letter) are printed in the server console.
Without ANTHROPIC_API_KEY, default interview questions are used and AI scoring is skipped.

## Flow
1. Admin invites candidate → login link + random password emailed.
2. Candidate takes 20-mark test (server-graded); score > 15 → selected.
3. Admin schedules Round 2 → candidate notified by email.
4. At the scheduled time candidate uploads resume; Claude generates tailored questions; camera + mic are recorded; tab switches counted; paste disabled.
5. Video (`uploads/*.webm`), transcript, AI score and feedback appear on the admin dashboard.
6. Admin reviews and clicks "Generate & send offer letter" → Claude writes it and it is emailed.

## Production notes
Use HTTPS (camera access requires it off localhost), move videos to S3, and set a strong JWT_SECRET.
