# MoraEvE

MoraEvE is a university event ticket website using Supabase Auth/PostgreSQL and PayHere sandbox checkout.

## Set up Supabase

1. Create a Supabase project.
2. Run all of `supabase.sql` in **Supabase Dashboard → SQL Editor**. It creates the event, order, and unique-ticket tables and seeds the sample events. Rerun it after updates to add new schema fields, such as event organizers.
3. In **Authentication → Providers → Email**, enable email and email confirmation. Google sign-in is not used.
4. In **Authentication → URL Configuration**, set the local Site URL to `http://localhost:3000` and allow that URL as a redirect.
5. Add the variables from `.env.example` to the existing `.env` (or create `.env` from the example if you do not have one). Keep your current Supabase URL and anon key; replace the placeholders with your own values. The service-role key is used only by the Node server and must never be put in browser code or shared.

## Configure PayHere sandbox

1. Create a **sandbox** merchant account at [PayHere Sandbox](https://sandbox.payhere.lk/merchant/sign-up). Sandbox accounts are separate from live accounts, and sandbox payments are simulated.
2. Sign in to the sandbox merchant portal and open **Side Menu → Integrations** to find your Merchant ID.
3. In **Integrations**, choose **Add Domain/App**, enter the domain or app you are registering, and request approval. Once it is approved, copy the Merchant Secret shown for it. The secret is specific to that domain/app; see PayHere's [Checkout API prerequisites](https://support.payhere.lk/api-&-mobile-sdk/checkout-api).
4. Put the sandbox values in your local `.env`:

       PAYHERE_MERCHANT_ID=your_sandbox_merchant_id
       PAYHERE_MERCHANT_SECRET=your_approved_domain_merchant_secret

   Do not use live credentials. For sandbox test cards, see PayHere's [Sandbox & Testing guide](https://support.payhere.lk/sandbox-and-testing).
5. Keep `APP_BASE_URL=http://localhost:3000` for local browser returns.
6. PayHere must reach the payment notification endpoint from the public internet. Start a secure tunnel to the local server (for example, `cloudflared tunnel --url http://localhost:3000` or an ngrok HTTPS tunnel), then set `PAYHERE_NOTIFY_URL` to the tunnel URL ending in `/api/payhere/notify`. Use the same HTTPS URL configured for the merchant in PayHere if it requests one.
7. Never paste PayHere or Supabase secrets into frontend files, chat, or source control. `.env` is ignored by Git.
8. After changing `.env`, stop the server with Ctrl+C and run `npm.cmd run dev` again so the Node process reloads the credentials.

## Run locally

Requires Node.js 18 or newer. From this folder, run in PowerShell:

    npm.cmd run dev

Open <http://localhost:3000>. The project uses only Node.js built-ins, so no package install is required. Run the focused payment signature tests with:

    npm.cmd test

## Ticket flow

- Users must sign in with an email-confirmed account.
- Any signed-in user can publish an event immediately by entering its organizer/club name, venue, date, and price. Set the price to `0` for a free event.
- Free event enrollment issues tickets immediately.
- Paid event checkout creates a pending order; unique ticket codes are issued only after the backend verifies PayHere's signed payment notification.
- Each order allows 1–5 tickets. Events do not have an overall capacity limit.
- A purchaser can see their codes under **My tickets**. Buyer name and email are stored with each ticket and order; administrators can review them in Supabase Table Editor under `public.tickets` and `public.ticket_orders`.

The PayHere success/cancel browser redirect is not treated as proof of payment. To test locally, the public tunnel must remain running so PayHere can post its signed notification to the app.
