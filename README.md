# MoraEvE

MoraEvE is a university event management and ticketing platform built to make event discovery, registration, and secure payments easier for both students and event organizers.

## Project Problem

Universities and student clubs often struggle with scattered event communication and manual registration processes. Students may not know about upcoming events, organizers may not have a simple way to publish event details, and payments need to be handled securely without risking fake or duplicate ticket sales.

This project solves that problem by creating a single digital platform where students can:

- discover upcoming events
- search and filter events by type or keyword
- sign in with verified email accounts
- register for free events instantly
- complete secure online payments for paid events
- view and manage their tickets from one place

## Solution

MoraEvE provides a simple event website where organizers can publish events with essential details like title, organizer, venue, date, and price. Attendees can browse events, sign in, and register using a verified flow. For paid events, the system creates a pending order and completes ticket issuance only after a verified payment notification is received from PayHere.

The platform is designed to be fast, reliable, and easy to use for university event promotion and attendance management.

## Key Features

- Event browsing and searching
- Organizer event publishing
- Email-confirmed sign-in
- Free event registration
- Secure PayHere sandbox payments
- Ticket generation and order tracking
- My Tickets dashboard for buyers
- PostgreSQL-backed data storage through Supabase

## Technologies We Used

- Frontend: HTML, CSS, and JavaScript
- Backend: Node.js
- Database and Authentication: Supabase (PostgreSQL + Auth)
- Payment Gateway: PayHere Sandbox Checkout
- Server-side validation and payment verification: JavaScript utility modules
- Testing: Node.js built-in test runner
- API and environment configuration: .env-based configuration

## Project Structure

- `index.html` – front-end interface
- `style.css` – styling for the website
- `script.js` – client-side logic
- `server.js` – Node.js server and API routes
- `event-utils.js` – event validation and processing
- `payment-utils.js` – payment hashing and signature verification
- `ticket-utils.js` – ticket generation and validation logic
- `supabase.sql` – database schema and setup for events and tickets

## Setup and Run Locally

1. Create a Supabase project.
2. Run the SQL from `supabase.sql` in the Supabase SQL editor.
3. Enable email sign-in and email confirmation in Supabase authentication.
4. Add your Supabase and PayHere sandbox values to a local `.env` file.
5. Start the app:

   npm.cmd run dev

6. Open http://localhost:3000 in the browser.

7. Run the tests:

   npm.cmd test

## Why This Project Matters

MoraEvE helps solve the real-world problem of disorganized event registration and payment handling in university communities. By bringing event publishing, ticket management, and payment verification into one platform, it improves accessibility, trust, and efficiency for both organizers and attendees.
