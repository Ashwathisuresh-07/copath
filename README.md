# Copath — split rides with people going the same way

A small React + Supabase app: post a trip, browse trips others posted, request to join,
and once the poster accepts, both people can see each other's phone number to coordinate
an Uber/Rapido split.

Contact numbers are enforced server-side (via Postgres row-level security in
`supabase/schema.sql`) — not just hidden in the UI — so they're genuinely inaccessible
until a request is accepted.

## 1. Create your Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (free tier is enough).
2. Once it's created, open **SQL Editor → New query**, paste the entire contents of
   `supabase/schema.sql`, and run it. This creates the `profiles`, `trips`, and
   `requests` tables with the correct security rules and turns on realtime updates.
3. Go to **Project Settings → API**. Copy the **Project URL** and the **anon public** key.

### Optional but recommended: turn off "Confirm email"
By default Supabase requires users to click a confirmation link before they can log in.
For a quick internal tool this adds friction. To turn it off:
**Authentication → Providers → Email → toggle off "Confirm email"**.
(The app works either way — if confirmation is on, users just complete their name/phone
after clicking the email link instead of right after signing up.)

## 2. Run it locally

```bash
npm install
cp .env.example .env
# paste your Project URL and anon key into .env
npm run dev
```

Open the local URL it prints.

## 3. Deploy for free (Vercel)

1. Push this folder to a GitHub repo.
2. Go to [vercel.com](https://vercel.com) → New Project → import the repo.
3. In **Environment Variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   (same values as your `.env`)
4. Deploy. Vercel gives you a live URL like `copath.vercel.app` that anyone can open.

Netlify works the same way if you'd rather use that.

## How it works

- **Auth**: Supabase email/password auth. Each user gets a row in `profiles` with their
  name and phone.
- **Trips**: anyone signed in can post and browse trips (`trips` table).
- **Requests**: a requester creates a row in `requests` with status `pending`. Only the
  trip's poster can flip it to `accepted` or `rejected`.
- **Contact reveal**: a Postgres policy on `profiles` only allows reading someone else's
  row if there's an `accepted` request connecting the two user IDs — so even a technically
  savvy user poking at the API can't see phone numbers they haven't been granted access to.
- **Realtime**: the app subscribes to Postgres changes on `trips` and `requests`, so new
  posts and accepted requests show up without refreshing.

## Making it invite-only / restricted later

This version is open to anyone who signs up. If you later want to restrict it (e.g. to
a college, company, or group):
- Simplest: check the email domain client-side at signup (easy to bypass, low effort).
- Real restriction: use Supabase's **domain-restricted OAuth** (Google/Microsoft) if your
  group uses Google Workspace or Microsoft 365 — this verifies the person actually owns
  an account on that domain, not just that they typed a matching string.
