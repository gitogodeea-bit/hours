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

If you edit `app.css`, `app.js` or `index.html`, **bump `CACHE` in `sw.js`**
(`hours-v1` → `hours-v2`). Phones that already have it cached will otherwise keep serving
the old files.

## Regenerating the icons

They were drawn by a PowerShell script using System.Drawing — teal `#0e6f6e` background,
white clock at ten past ten. Any 192px and 512px PNG will do as a replacement; keep the
filenames, or change them in both `manifest.webmanifest` and `sw.js`.
