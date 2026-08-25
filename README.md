# ☕ Coffee Map

A personal map of every coffee you've tried. Click a country to see what you've had from
it and add a new one; filter by variety, process, roaster or flavour note to light up every
country matching — "show me everywhere I've had a Gesha from."

It's a plain static site: no build step, no framework, no server. The repo itself is what
gets deployed.

---

## How your data is stored

Everything lives in [`data/coffees.json`](data/coffees.json) in this repo.

- **Reading** needs nothing. The page fetches that file directly.
- **Writing** goes through the GitHub API using a token you paste into each browser.
  Every save is a commit, so you get full history and can recover anything you delete.

Without a token the app still works — edits are saved in that browser only, and the header
dot turns amber to say so. Add a token and those local edits get pushed on the next save.

| Sync dot | Meaning                                        |
| -------- | ---------------------------------------------- |
| green    | synced with GitHub                             |
| amber    | saved on this device only, or a push is queued |
| red      | last sync failed — open Settings               |

---

## First-time setup

### 1. Create the repo and push

Create an empty **public** repo named `coffee-map` on GitHub (don't add a README — this
folder already has one), then:

```bash
git remote add origin https://github.com/rgsheld/coffee-map.git && git branch -M main && git push -u origin main
```

A public repo matters: GitHub Pages is free on public repos, and the page can read your
coffee list without anyone signing in. The contents are just coffee names and tasting notes.

### 2. Turn on GitHub Pages

Repo **Settings → Pages → Build and deployment**. Set source to **Deploy from a branch**,
branch `main`, folder `/ (root)`. After a minute the site is live at:

```
https://rgsheld.github.io/coffee-map/
```

### 3. Create a token (per person, not per device)

Go to **[github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)** and create a
**fine-grained** token:

- **Repository access** → *Only select repositories* → `coffee-map`
- **Permissions** → *Repository permissions* → **Contents: Read and write**
- **Expiration** → set one. When it lapses the app will say so; just make a new one.

Copy the token — GitHub only shows it once.

### 4. Connect each browser

Open the site, hit the **⚙ gear**, paste the token, press **Test connection**, then **Save**.
Repeat on your phone (the token goes in that browser's local storage; it's never sent
anywhere except api.github.com).

To put it on your phone home screen: Safari → Share → *Add to Home Screen*.

---

## Using it

- **Click any country** to see what you've had from it, or to add a coffee.
- **+ Add coffee** in the header works from anywhere, and is the way to log the island
  origins that are too small to click (São Tomé, Comoros, Mauritius, Cabo Verde) — once
  they have a coffee they appear as a circle on the map.
- **Filter chips** in the sidebar highlight matching countries in gold and dim the rest.
  Picking several values in one group means *any of them*; picking across groups narrows
  (`Gesha` + `Natural` = naturally-processed Geshas only).
- **Shade by** switches the map between number tried and average rating.
- **`/`** focuses the search box. **Esc** closes panels.
- **Blends** are first-class. A coffee holds one or more *origins*; hit **+ Add origin**
  in the form to add another. Each origin carries its own country, region, producer,
  variety, process, altitude and share, because those travel together — the Gesha half
  is the natural one, the Caturra half is the washed one.
- A blend is listed under every country it draws on, and counts toward each. Filtering
  lights up only the origin that actually matched: filter on `Gesha` and a Brazil/Ethiopia
  blend highlights just the country that grew the Gesha.
- Because origins are kept whole, `Gesha` + `Washed` matches only a coffee where one
  origin is *both*. A flat list of varieties and processes would report a natural Gesha
  blended with a washed Caturra as a washed Gesha, which it never was.
- Variety and flavour notes are comma-separated, and every text field autocompletes from
  what you've already entered — worth accepting the suggestion so the filters group
  cleanly (`Gesha` and `Geisha` would otherwise be two separate chips).

---

## Running it locally

```bash
python3 -m http.server 8842
```

Then open <http://127.0.0.1:8842>. It must be served over HTTP — opening `index.html`
straight off disk breaks the ES module imports.

---

## Troubleshooting

**"Token expired or invalid"** — fine-grained tokens expire. Make a new one (step 3) and
paste it into Settings.

**A change I made doesn't show on my other device** — GitHub Pages caches for up to a
minute after a commit. Reload. Devices with a token read through the API instead and see
changes immediately.

**I edited the code and the browser is running the old version** — Pages caches JS and CSS
for around 10 minutes. Hard-reload (⌘⇧R) to bypass it.

**Two devices edited at once** — the app detects it, re-reads the file, replays your change
on top and retries, so neither edit is lost.

---

## Layout

```
index.html            markup for the map, sidebar, panel and dialogs
css/app.css           all styling, incl. the mobile bottom-sheet breakpoint
js/app.js             bootstrap; owns filter/selection state, drives rendering
js/store.js           the coffee list: load, save, localStorage, conflict retry
js/github.js          GitHub Contents API client, UTF-8-safe base64
js/map.js             Leaflet setup, choropleth, highlighting, island fallbacks
js/filters.js         facet index and filter logic
js/ui.js              facet chips, coffee cards, the form, toasts
js/vendor/            Leaflet 1.9.4, vendored so there are no CDN dependencies
data/coffees.json     your coffees
data/countries.geo.json  world country polygons, keyed by ISO alpha-3
```

### Data shape

`data/coffees.json` is `{ version: 2, updatedAt, coffees: [...] }`. Each coffee keeps what
belongs to the cup as drunk — `name`, `roaster`, `flavorNotes`, `rating`, `dateTried`,
`notes` — plus a `components` array. Each component is one origin: `country` (ISO alpha-3),
`region`, `producer`, `variety[]`, `process`, `altitude`, `share`.

Version 1 kept `country`/`region`/`variety`/`process`/`altitude` flat on the coffee and is
migrated automatically on load, so an old file still opens. A v1 `process` of
`"honey, washed"` is split into one component per process, pairing varieties positionally
when the counts line up — check those entries once after upgrading.

Two rules worth keeping if you edit the code:

- `normalise()` in `js/store.js` spreads the original object before coercing fields, so a
  field a newer version adds is not stripped by an older browser tab still running cached
  JavaScript. `serialise()` rewrites the whole file on every save, so without that spread
  one stale tab would silently drop a column from every coffee.
- `index.html` and the `import` statements carry a `?v=N` query string. Bump **all of them
  together** when you deploy, or a fresh `app.js` can pull a stale `store.js`.

The map draws no tile layer — just country polygons on a flat background. That means the
page makes no third-party requests at all, works offline, and stays quick on a phone.
