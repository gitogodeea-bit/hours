# Hours

A small installable web app (PWA) for keeping a timesheet when you do not work regular
shifts: clock in, clock out, correct the times afterwards, keep an hourly rate, and pull
a report for a month or any period you pick.

Nothing to do with the Splash Salons till system — separate folder, separate code, no
server, no database, no account.

## Files

| file | what it is |
|---|---|
| `index.html` | the whole interface — four tabs and two dialogs |
| `app.css` | styling, light and dark, sized for a phone |
| `app.js` | all the logic |
| `manifest.webmanifest` | makes it installable (name, icons, standalone display) |
| `sw.js` | service worker — caches the app so it opens with no signal |
| `icons/` | 192px, 512px, and a maskable 512px icon |

## Where the data lives

In the phone's `localStorage`, under the key `hours.v1`. **On the phone only.** It is never
sent anywhere and there is no account, so:

- Clearing Chrome's site data for the address wipes it.
- A new phone does not get it automatically.
- **It is tied to the web address.** If the app is later moved to a different URL, the
  saved shifts do not follow. Use *Settings → Export backup*, then *Restore from backup*
  at the new address.

Take an export every so often. It is one small `.json` file in Downloads.

## How the numbers work

- Hours = end − start − unpaid break, to the minute.
- A finish time earlier than the start is treated as **the next morning**, so a 22:00–02:30
  night is 4h 30m, not a negative number. The editor says "finishes next day" when this
  applies.
- **Each shift stores its own hourly rate**, copied from Settings when the shift is created.
  Changing the rate in Settings only affects new shifts — a pay rise does not silently
  rewrite what you earned in March. To apply a rise backwards, use
  *Settings → Apply this rate to a date range…*.
- If a report covers shifts at different rates it says "mixed rates" instead of one figure.
- In the CSV, each shift's pay is rounded to the penny but the **total is worked out from
  the unrounded figures**, so the column can occasionally add up a penny off the total.
  The total is the correct one.

## Installing it on the phone

The app has to be served over **https** for Chrome to offer a real install (this is a
browser rule, not a choice in the code). Once it is at an https address:

1. Open that address in Chrome on the Galaxy S22 Ultra.
2. Menu (⋮) → **Add to Home screen** → **Install**.
   *Or* open Settings inside the app and tap **Install app** if the button is showing.
3. It now appears in the app drawer with its own icon and opens full screen, no browser bars.

After the first visit it works with no signal at all.

## Running it locally on this PC

XAMPP's PHP is enough:

```bash
"C:\xampp\php\php.exe" -S 127.0.0.1:8123 -t "C:\Users\Dfrom\OneDrive\Desktop\Splash Hours"
```

Then open <http://localhost:8123>. Service workers are allowed on `localhost` without
https, so installing works there too.

## Changing the app later

If you edit `app.css`, `app.js` or `index.html`:

1. **Bump `CACHE` in `sw.js`** (`hours-v2` → `hours-v3`).
2. **Bump the `?v=` on the `app.css` / `app.js` links in `index.html`**, and match them in
   the `SHELL` list in `sw.js`.
3. Bump the build number in the `<p class="version">` line, so the phone can be asked which
   build it is actually running.
4. Commit and `git push origin main`. Pages rebuilds in a minute or two.

The worker is network-first, so a fresh copy wins whenever there is signal; the cache is
only the offline fallback. That is deliberate — cache-first meant a broken build pinned
itself on the phone and could not be fixed remotely.

## Browser support — the one that bit

**Build 1 did not start at all on Samsung Internet.** The page rendered, and every tap did
nothing. The cause was `structuredClone()`, which does not exist below Chromium 98 and was
the first call made on startup, so the whole script died before a single event handler was
attached — and the `catch` block called it again, so it could not recover either.

Two lessons baked into the code:

- Stick to widely-supported APIs. This app deliberately uses nothing newer than about 2019.
- `index.html` carries a small inline `window.onerror` handler that prints the failure in a
  red box at the top of the screen. A silent failure looks identical to a working app on a
  phone you cannot open a console on.

## Regenerating the icons

They were drawn by a PowerShell script using System.Drawing — teal `#0e6f6e` background,
white clock at ten past ten. Any 192px and 512px PNG will do as a replacement; keep the
filenames, or change them in both `manifest.webmanifest` and `sw.js`.

## Invoicing (build 3)

Added so that settled hours can be cleared from view **without deleting anything** — the
previous workaround was erasing everything from Settings, which threw away the history too.

A shift moves through two states, both optional and both reversible:

| state | set by | what it does |
|---|---|---|
| **invoiced** | `invoiceNo` stamped on the shift | stops the same hours being billed twice |
| **paid** | `paidOn` date stamped on the shift | takes it out of the outstanding balance |

- **Report → Create invoice** bills every *un-invoiced* shift in the chosen period. Already
  invoiced shifts are skipped, so pressing it twice cannot double-bill.
- The invoice opens as a white "paper" sheet — it stays white in dark mode because it is a
  document and it has to print. **Save / Print** uses the browser's own print dialogue,
  where Chrome on Android offers *Save as PDF*.
- **Mark as paid** stamps today's date on every shift on that invoice. The same button then
  reverses it.
- **Delete** removes the invoice but *keeps the shifts*, releasing them back to
  un-invoiced and unpaid so they can be billed again.
- The **Now** screen shows the running balance of everything worked and not yet paid for,
  and says "All settled" rather than going blank once nothing is outstanding.
- Invoice numbering is `prefix + zero-padded counter`, both editable in Settings.
- Figures on an invoice are recomputed from the shifts each time it is opened, so
  correcting a mistyped shift also corrects the invoice instead of leaving them disagreeing.

Invoice details (your name, contact, who to bill, payment terms) live in Settings and are
snapshotted onto each invoice when it is created.

### A note on the service worker precache

`install` adds each shell file individually rather than with `cache.addAll()`. `addAll()` is
all-or-nothing: one asset that fails to fetch discards the whole precache and leaves the app
with nothing offline. This is not theoretical — PHP's built-in dev server is single-threaded,
so the eight parallel precache requests race it and some fail.
