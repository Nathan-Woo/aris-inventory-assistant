# Ari's Inventory Assistant

A cute, colorful jewelry inventory tracker: add items, track live stock,
record sales, see a full ledger, view sales stats, manage matching sets,
and share the whole inventory with friends/family by email.

**Stack:** plain HTML/CSS/JS (no build step) + Firebase (Google sign-in,
Firestore, Storage) + GitHub Pages — the same stack as your finance
tracker and Italian citizenship app.

The project folder can be named anything and live anywhere on your
computer — nothing below depends on a specific name or location.

---

## Opening a terminal in the right place (do this first, every time)

A lot of setup problems come from typing or pasting a `cd C:\some\long\path`
command by hand — it's easy to double-paste or fat-finger it. Skip that
entirely by opening a terminal that's *already* in the project folder:

- **In VS Code:** File → Open Folder… → select this project folder. Then
  open the integrated terminal (Terminal → New Terminal, or `` Ctrl+` ``).
  It starts in this exact folder automatically.
- **In File Explorer:** open the project folder, then Shift+Right-click
  in the empty space and choose "Open PowerShell window here" (or "Open
  in Terminal").

Every command below assumes you're using one of those — no `cd` needed.

## 1. Create the Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** → name it (e.g. `aris-inventory`) → finish the wizard.
2. **Authentication** → **Get started** → **Sign-in method** → enable **Google**.
3. **Firestore Database** → **Create database** → start in **Production mode** → pick a region.
4. **Storage** → **Get started** → keep the default rules for now (we'll replace them). Make sure you get all the way to seeing the file browser view (not just a "Get started" button) — that confirms the bucket actually got created.
5. **Project settings** (gear icon) → **General** → scroll to **Your apps** → click the **</>** (web) icon → register an app (any nickname) → you'll see a `firebaseConfig` object. Keep this tab open.

## 2. Drop your config into the code

Open `app.js` in VS Code and find the `firebaseConfig` block near the top
(clearly marked). Replace the `YOUR_...` placeholders with the real values
from step 1.5. These values are safe to commit — access is controlled by
the security rules below, not by hiding the config.

## 3. Connect the CLI to your project

```powershell
npm install -g firebase-tools
firebase login
firebase projects:list
```

Copy the exact **Project ID** (lowercase, e.g. `aris-inventory-a1b2c`) from
that list — it won't necessarily match the name you typed when creating
the project.

```powershell
firebase use --add
```

Pick your project from the list, and when it asks for an alias, type
`default`. This writes your real project ID into `.firebaserc` — from now
on, **don't overwrite `.firebaserc`** with a fresh copy from me (see
"Updating later" below), or you'll be back to square one.

## 4. Deploy the security rules

```powershell
firebase deploy --only firestore:rules,storage:rules
```

If this is the very first deploy and it complains about storage targets,
run `firebase init storage` (choose `storage.rules` as the rules file,
confirm overwrite) and try the deploy command again — this reconfirms the
Storage bucket is properly linked.

## 5. Run it locally (optional but recommended)

```powershell
npx serve .
```

Open the printed `localhost` URL. Sign in with Google and try adding an
item. (`localhost` is authorized for Google sign-in by default.)

## 6. Push to GitHub

```powershell
git init
git add .
git commit -m "Ari's Inventory Assistant"
git branch -M main
git remote add origin https://github.com/YOUR-USERNAME/aris-inventory-assistant.git
git push -u origin main
```

**If you ever move or copy this project into a different folder** and
repeat these steps there, `git push` may get rejected with something like
`! [rejected] main -> main (non-fast-forward)`. That just means the new
folder has a fresh, separate Git history that doesn't know about the
commit already on GitHub — it's not a sign anything is broken. Since this
is your own solo project, the fix is to make your current local files the
canonical version:

```powershell
git remote -v                      # confirm origin points at your repo;
                                    # if not: git remote remove origin, then
                                    # git remote add origin <your repo URL>
git push -u origin main --force
```

`--force` overwrites what's on GitHub with your local copy — fine for a
solo project, but avoid it on anything you're sharing commits with someone
else on.

## 7. Turn on GitHub Pages

1. On GitHub: repo → **Settings** → **Pages**.
2. **Source**: "Deploy from a branch" → **Branch**: `main`, folder `/ (root)` → **Save**.
3. GitHub gives you a URL like `https://YOUR-USERNAME.github.io/aris-inventory-assistant/`. It can take a minute or two to go live.

## 8. Authorize your live domain for Google sign-in

Back in Firebase console → **Authentication** → **Settings** → **Authorized domains** →
**Add domain** → add `YOUR-USERNAME.github.io`.

That's it — the site is now live and anyone with the link can open it and
sign in with their own Google account.

---

## Updating to a newer version later

When I hand you updated files, only replace the **code** files:

- `index.html`, `app.js`, `styles.css`, `manifest.json`, `icon.svg`
- `firestore.rules` / `storage.rules` — but only if I've told you these
  changed, and re-run `firebase deploy --only firestore:rules,storage:rules`
  afterward

**Never overwrite `.firebaserc`** — it holds the connection to *your*
Firebase project, which you set up once in step 3. Overwriting it is what
caused the "Invalid project id" and storage-target errors to come back
after copying in a new zip. If you're not sure, open `.firebaserc` first —
if it already has your real project ID in it, leave it alone.

`firebase.json` is also safe to leave alone once things are working,
even if a new zip includes a copy — they should match, but if
`firebase init storage` ever changes yours locally to fix something,
keep your local version.

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

Photos are uploaded to Firebase Storage under `photos/{your-uid}/...`
(resized client-side first) and referenced by URL — never stored as huge
base64 blobs in Firestore.
