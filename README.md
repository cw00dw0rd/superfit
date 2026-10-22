# SF Planner (Superfit class planner)

A local-only app to search Superfit classes across studios, plan an agenda, invite friends and
track workouts. There's no backend: all data lives on the device.

## Features

- **Class search**: text search, studio chips (remembered), Kursplan/Teamtraining, day and time-of-day filters.
- **Class details**: what the class is (Les Mills programs and common class types), intensity, what to bring, and a Google Maps route.
- **Agenda**: pick one of the next four dates for a class; pending classes ask "Did you go?".
- **Invites**: per-friend WhatsApp, SMS or email, plus the system share sheet. Calendar invites go through
  a Google Calendar link with your friends' emails pre-filled as guests (saving it sends real invites), or an `.ics` file.
- **Friends**: added by hand, or picked from contacts where the browser supports it (Chrome on Android).
- **Workout tracking and gamification**: log from the agenda or by hand; weekly goal, week streak, points, levels, badges.
- **Schedule updates**: "Check superfit.club for changes" crawls the studio overview, finds each studio's plan PDFs,
  and re-parses only those whose URL changed (Webflow gives re-uploads a new URL). It then shows what was added or removed.
  "Import plan PDFs" parses PDFs you've downloaded yourself.
- **Backup**: export and import all local data as JSON.

## How the PDF reading works

In the Superfit plan PDFs, the times and weekday headers are real text, but the **class names are vector outlines**,
not text. `www/js/pdfparse.js` gets the drawing operations through pdf.js and finds each tile by its time text. It then
groups the glyph outlines above that text into rows (bottom row = class name, next row = brand) and matches every glyph
against the prototypes in `www/data/glyphs.json`. In effect it's a tiny OCR that runs entirely on the device.

It was trained on the Mitte plans from 01.10.2026 (99/99 classes correct) and now reads all 12 studios' plans (960 classes) with no unknown glyphs. Trained on the Kursplan alone, it also read the unseen
Teamtraining names. If a future plan uses a letter it has never seen, that name shows a `?`. You can fix it under
Settings (the fix is remembered), or retrain:

```sh
# add the PDF's contents to a labels file (see tools/labels-mitte-2026-10.json), then:
npm run glyphs:train -- tools/labels-<x>.json path/to/new.pdf
npm run glyphs:verify -- tools/labels-<x>.json path/to/new.pdf
```

## Running it

| Target | How |
| --- | --- |
| **Try locally** | `npm run serve`, then open http://localhost:8000 |
| **Web (Android + iPhone)** | Push to GitHub and enable Pages (Settings → Pages → Source: GitHub Actions). The *Publish web app* workflow deploys `www/`. Open the URL, then **Android (Chrome):** ⋮ → *Install app* / *Add to Home screen*. **iPhone (Safari):** Share → *Add to Home Screen*. |
| **Android app (APK, optional)** | Run the *Build Android APK* workflow manually (Actions tab). It uploads `app-debug.apk` as an artifact. Locally: `npm run android:sync && cd android && ./gradlew assembleDebug` (needs the Android SDK). |

### How "Check for updates" works

1. It tries to crawl superfit.club directly: read the studio overview and studio pages, and re-parse only PDFs whose URL changed.
   This works in the Android APK, where Capacitor's native HTTP is not subject to browser CORS rules.
2. Browsers can't read superfit.club pages (the site sends no CORS header), so the web/iPhone app falls back to the
   **schedule feed**: `data/schedule.json` published next to the app. The *Publish web app* workflow re-crawls superfit.club
   **every day** (04:17 UTC), commits the schedule if anything changed and redeploys. The app shows what was added or removed.
3. Manual fallback: "Import plan PDFs" parses PDFs you've downloaded.

The plan PDFs themselves live on Webflow's CDN, which *does* allow cross-origin reads. Only discovering new PDF links needs the crawl.

## Seeding/refreshing the bundled schedule

```sh
npm run schedule:sync                                 # crawl superfit.club (behind a proxy: NODE_USE_ENV_PROXY=1)
npm run schedule:pdf -- mitte KP_MI.pdf TT_MI.pdf     # or add one studio from local PDFs
npm run test:sync -- KP.pdf TT.pdf                    # offline test of crawler + change detection
```

## Layout

```
www/                 the app (static: HTML/CSS/JS, no build step)
  app.js             UI, state, invites, calendar, gamification
  js/pdfparse.js     plan-PDF parser (shared by app and Node tools)
  js/sync.js         superfit.club crawler + change detection (shared)
  data/              schedule.json, classinfo.json (class descriptions), glyphs.json
  vendor/            pdf.js 4.10.38 (loaded only when parsing)
tools/               Node CLIs: build schedule, train/verify glyphs, sync test
capacitor.config.json  Android wrapper config
```

## Ideas for later

- Native share of `.ics` files and native contact picker on Android (Capacitor plugins).
- Recurring agenda entries ("every Tuesday BODYPUMP").
- Reminders via local notifications (`@capacitor/local-notifications`).
- More class descriptions in `www/data/classinfo.json` (keyword-matched, first match wins).
