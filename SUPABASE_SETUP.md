# Coach Brain Pro account setup

This adds email sign-in and a Pro entitlement record. It does **not** put a secret key in the browser.

## 1. Create the database and sign-in service

1. Create a project at [Supabase](https://supabase.com/).
2. In **Authentication → URL Configuration**, add these redirect URLs:
   - `https://yuji0913sakurai-coder.github.io/coach-brain-swim-planner-pro/`
   - `http://localhost:3000/`
3. In **SQL Editor**, run the full contents of [`supabase/schema.sql`](supabase/schema.sql).
4. In **Project Settings → API**, copy the Project URL and the **publishable** key. Do not use a secret/service-role key in this app.

## 2. Make the public website use Supabase

In the GitHub repository, open **Settings → Secrets and variables → Actions** and create these two repository secrets:

| Name | Value |
| --- | --- |
| `REACT_APP_SUPABASE_URL` | Your Supabase Project URL |
| `REACT_APP_SUPABASE_PUBLISHABLE_KEY` | Your Supabase publishable key |

After the workflow update is pushed, GitHub Pages builds the site with these values. The publishable key is designed for browser use; Supabase Row Level Security in `schema.sql` ensures a signed-in coach can read only their own entitlement.

## 3. First 25 paid Founding Coaches (legacy offer)

Until automated Gumroad webhooks are added, use a careful manual activation step:

1. The buyer purchases with their email address.
2. They use that same address to sign in to Coach Brain.
3. You verify the Gumroad sale, then run the activation query at the end of `supabase/schema.sql` in Supabase SQL Editor.

This is intentional for launch: it keeps payment secrets off the public site and gives you a clear opportunity to verify the first 25 buyers. The next technical milestone is a server-side Gumroad webhook that automates this activation.

## 4. Complimentary Founding Coach Program

The separate 90-day invitation program is documented in [founding-coach-program.md](docs/founding-coach-program.md). Its migration is review-only until explicit production approval. Do not grant a complimentary invitation by setting `coach_access.plan = 'pro'`: that table continues to represent existing purchased/manual Pro access, without a trial expiry. The invitation migration does not implement or change Gumroad checkout, pricing, discounts, or paid activation.
