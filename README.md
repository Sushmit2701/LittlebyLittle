# Daily Chunker

A small, personal planner. You say what's pending and when it's due. It splits each task into 10- or 30-minute chunks, spreads them across the days before the deadline, and each day shows you only today's bit.

One user, no login, no server. Everything is stored in your browser (`localStorage`) on your phone.

## Open it on your iPhone

The app is plain HTML, CSS and JavaScript, so any static host works. The simplest is GitHub Pages:

1. On GitHub, open this repository → **Settings** → **Pages**.
2. Under **Build and deployment**, set **Source** to *Deploy from a branch*, pick the branch that has this code (for example `main`) and the `/ (root)` folder, then **Save**.
3. After a minute the page shows the address, something like `https://<your-username>.github.io/LittlebyLittle/`.
4. Open that address in **Safari** on your iPhone, tap **Share** → **Add to Home Screen**.

Open it from the home-screen icon from then on. That matters: Safari can clear storage for websites you haven't visited in a while, but home-screen apps keep their data. It also works offline.

### Run it on a computer

```sh
python3 -m http.server 8080
```

Then open http://localhost:8080. Run the tests with `npm test` (Node 20 or newer, no packages to install).

## Sync between iPhone, iPad and Mac

Sync is optional. It uses the **same free Supabase project as Bibliophile**, so you sign in with the same account. Daily Chunker keeps its data in its own table and never touches your books.

**One-time setup in Supabase (about 3 minutes):**

1. Open your project at [supabase.com](https://supabase.com) → **SQL Editor** → **New query**.
2. Copy everything from [`supabase/chunker.sql`](supabase/chunker.sql), paste it in, and press **Run**. It's safe to run again.
3. Open **Authentication → URL Configuration → Redirect URLs** → **Add URL**, and add:
   `https://sushmit2701.github.io/LittlebyLittle/**`

**On each device:** open the app → **Settings** (top right) → **Sync across devices** → enter your email → **Email me a code**, then type the code. If Google sign-in is switched on for Bibliophile, **Continue with Google** works too.

> On iPhone and iPad, a sign-in *link* opens in Safari rather than the home-screen app, so type the **code** from the email, or use Google. (Bibliophile's setup notes explain how to put the code in the email.)

What syncs: tasks, ticked chunks, habits and settings. Your Anthropic key and light/dark choice stay on each device. If a task is changed on two devices, the later change wins, but a chunk ticked on any device stays ticked. Offline changes sync when you're back online. Signing out keeps everything on that device.

## What it does

**Three screens**

- **Today**: only today's chunks, each with a tick, a focus timer and a *Too much today* button. A progress ring for the day, your habits for the day, and a *This week* card that counts what you did, never what you missed.
- **Add**: dictate into the big box (the keyboard's dictation key works; the mic button uses the browser's speech recognition where available) or use the form. It picks out the task, the deadline and the total time. If one is missing, it asks you one question.
- **All tasks**: soonest deadline first, with percent done and chunks left. Tap one to edit, re-split or delete it. Habits live here too.

**How the plan is made** (`js/scheduler.js`)

- Each task is split into chunks of 10 or 30 minutes (your choice per task, 30 by default).
- Chunks are spread evenly from today to **the day before the deadline**, so there's a day of buffer.
- No day gets more than your daily limit (90 minutes by default). Habits don't count towards it.
- Your usual days off and any unavailable dates (on call, leave) are skipped.
- High-priority tasks are packed into the first half of their window.
- If a task can't fit, it tells you how much doesn't fit and offers two one-tap fixes: the nearest deadline that works, or the daily limit that would make it fit.
- Today's plan never moves under you. *Too much today* moves that chunk to tomorrow or later, adds nothing new to today, and rebalances the rest.
- If you skip a day, the missed chunks are quietly spread over the coming days the next time you open the app.

**Calendar**

- *Add today's chunks to calendar* (Today screen) and *Add upcoming chunks to calendar* (All tasks) make a standard `.ics` file. On iPhone it opens the share sheet, or downloads the file; open it to add the events.
- Chunks are placed at your preferred time of day (morning, lunchtime or evening, each with an editable start time), one after another with a 5-minute breather.

**Optional AI**

Paste an Anthropic API key in Settings and dictation is read by Claude, and chunks get short step names ("Part 2 of 6: Collect data") instead of just "Part 2 of 6". The key stays on your phone and is sent only to `api.anthropic.com`. Without a key, everything works offline with the built-in reader.

## Files

| File | What it holds |
| --- | --- |
| `index.html`, `css/styles.css` | The page and its look (calm colours, large tap targets, dark mode) |
| `js/app.js` | Screens, buttons, timer, settings |
| `js/scheduler.js` | Splitting, scheduling, rebalancing, weekly summary |
| `js/parser.js` | Reads dictated text: names, deadlines, durations |
| `js/ics.js` | Calendar file export |
| `js/ai.js` | Optional Claude calls |
| `js/cloud.js`, `js/sync-merge.js`, `js/cloud-config.js` | Optional sign-in and sync (Supabase) |
| `supabase/chunker.sql` | The sync table and its security rules |
| `js/store.js`, `js/dates.js` | Saved data and date helpers |
| `sw.js`, `manifest.webmanifest`, `icons/` | Home-screen install and offline use |
| `tests/` | Tests for the scheduler, parser and calendar file |

## Roadmap (not built yet)

- Google Calendar two-way sync.
- Fuller AI task breakdown.
- Voice-only quick add from the home screen.
- A gentle morning notification showing today's chunk.
- Backup and restore of your data to a file.
