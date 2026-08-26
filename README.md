# Ari's Inventory Assistant

A cute, colorful jewelry inventory tracker: add items, track live stock,
record sales, see a full ledger, view sales stats, manage matching sets,
and share the whole inventory with friends/family by email.

**Stack:** plain HTML/CSS/JS (no build step) + Firebase (Google sign-in,
Firestore, Storage) + GitHub Pages — the same stack as your finance
tracker and Italian citizenship app.

---

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `aris-inventory`) → finish the wizard.
2. **Authentication** → **Get started** → **Sign-in method** → enable **Google**.
3. **Firestore Database** → **Create database** → start in **Production mode** → pick a region.
4. **Storage** → **Get started** → keep the default rules for now (we'll replace them).
5. **Project settings** (gear icon) → **General** → scroll to **Your apps** → click the **</>** (web) icon → register an app (any nickname) → you'll see a `firebaseConfig` object. Keep this tab open.

## 2. Drop your config into the code

Open `app.js` in VS Code and find the `firebaseConfig` block near the top
(clearly marked). Replace the `YOUR_...` placeholders with the real values
from step 1.5. These values are safe to commit — access is controlled by
the security rules below, not by hiding the config.

## 3. Deploy the security rules

You only need to do this part with the Firebase CLI (one-time, and again
any time you change `firestore.rules` or `storage.rules`).

First, unzip the project and make sure you `cd` into the folder that
directly contains `index.html`, `app.js`, `firebase.json`, etc. (not a
parent folder). You can check with `dir` (Windows) or `ls` (Mac/Linux) —
you should see `firebase.json` in the listing.

```bash
npm install -g firebase-tools
firebase login
cd path\to\aris-inventory-assistant     # the folder with firebase.json in it
firebase use --add                      # pick your project, alias it "default"
firebase deploy --only firestore:rules,storage:rules
```

If `cd` says the path doesn't exist, you're most likely one folder level
off — use `dir` (or, in File Explorer, click into the folder and copy its
address bar) to find the exact path first, then `cd` straight to that.

This also updates `.firebaserc` with your real project ID — commit that change.

## 4. Run it locally (optional but recommended)

Any static file server works, e.g.:

```bash
npx serve .
# or: python3 -m http.server 8080
```

Open the printed `localhost` URL. Sign in with Google and try adding an item.
(`localhost` is authorized for Google sign-in by default.)

## 5. Push to GitHub

```bash
git init
git add .
git commit -m "Ari's Inventory Assistant"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/aris-inventory-assistant.git
git push -u origin main
```

## 6. Turn on GitHub Pages

1. On GitHub: repo → **Settings** → **Pages**.
2. **Source**: "Deploy from a branch" → **Branch**: `main`, folder `/ (root)` → **Save**.
3. GitHub gives you a URL like `https://YOUR-USERNAME.github.io/aris-inventory-assistant/`. It can take a minute or two to go live.

## 7. Authorize your live domain for Google sign-in

Back in Firebase console → **Authentication** → **Settings** → **Authorized domains** →
**Add domain** → add `YOUR-USERNAME.github.io`.

That's it — the site is now live and anyone with the link can open it and
sign in with their own Google account.

---

## How sharing works (the Friends tab)

- Every account starts with its own **private** inventory (a "group" of one).
- In the **Friends** tab, add someone's email to send them an invite.
- When they sign in and open their own Friends tab, they'll see the invite
  under "Invites for you" and can **Accept**. Accepting merges their
  inventory into yours — from then on the Add Items, Live, Sold, Ledger,
  and Stats tabs show the exact same shared data for everyone in the group.
- Anyone can **Leave shared inventory** at any time. The items they
  personally added come with them into a fresh private inventory; shared
  items stay with the rest of the group.
- This is a trust-based model meant for a small group of friends/family —
  it doesn't have granular per-item permissions.

## Data model (for reference)

- `users/{uid}` — profile + which `groupId` you currently belong to
- `groups/{groupId}` — the shared "household": list of member emails
- `entries/{id}`, `sets/{id}`, `soldTx/{id}` — all tagged with `groupId`;
  every read/write is scoped to your current group by the security rules
- `linkInvites/{id}` — pending/accepted/declined friend invitations

Photos are uploaded to Firebase Storage (resized client-side first) and
referenced by URL — never stored as huge base64 blobs in Firestore.

## Updating the site later

Any time you change files and push to `main`, GitHub Pages redeploys
automatically within a minute or two. If you change `firestore.rules` or
`storage.rules`, also re-run:

```bash
firebase deploy --only firestore:rules,storage:rules
```

**If you're updating from an earlier copy of this project:** `storage.rules`
changed (photo paths are now scoped by your user ID instead of a Firestore
lookup, which is more reliable). Re-run the command above after pulling the
update, or photo uploads will keep failing against the old rules.
