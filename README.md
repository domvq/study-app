# StudyAI

Type what you want to study, or upload a document — StudyAI searches the web for context, then generates:

- **Flashcards** — flip, shuffle, track known vs. still learning
- **Slideshow** — a presentable deck built from your material
- **Quizzes** — multiple-choice, with instant scoring
- **Study guides** — big picture, key terms, a 30-minute study plan
- **Expert solutions** — step-by-step method, worked example, common pitfalls
- **Spark Notes** — a 60-second summary, themes, and quick facts

## How it works (no backend)

This is a **static site**: `index.html`, `styles.css`, and `app.js` only. No build step, no server, no database.

- Web search uses the free Wikipedia API — no key needed.
- Document upload reads `.txt` / `.md` directly in your browser, and `.pdf` via PDF.js from a CDN.
- The built-in generator turns your text + the Wikipedia summary into all six outputs.
- Optional: in the app, open “use a real AI API” and add an OpenAI-compatible base URL, key, and model. The key is stored only in your browser (`localStorage`) and is never required.

Your documents never leave your browser unless you choose to use an external AI API.

## Run it locally

```bash
# Any static server works, e.g.:
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` in a browser (Wikipedia search needs internet).

## Deploy through GitHub (GitHub Pages)

### Option A — automatic, with the included workflow (recommended)

1. Create a new repository on GitHub, e.g. `study-ai-app`.
2. Push this folder to it:
   ```bash
   git init
   git add .
   git commit -m "Add StudyAI app"
   git branch -M main
   git remote add origin https://github.com/<your-username>/study-ai-app.git
   git push -u origin main
   ```
3. On GitHub, go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
4. Push again (or re-run the workflow from **Actions**). Your site will be live at:
   ```
   https://<your-username>.github.io/study-ai-app/
   ```
   The workflow in `.github/workflows/pages.yml` does the deploy automatically on every push to `main`.

### Option B — manual Pages deploy

1. Push as above.
2. Go to **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, and save.
3. Your site appears at the same `https://<your-username>.github.io/study-ai-app/` address.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page structure, input form, all six output tabs |
| `styles.css` | Layout and styling |
| `app.js` | Search, upload, and all six generators |
| `.github/workflows/pages.yml` | GitHub Pages deploy on push to `main` |

## Customising

- Change colours / layout in `styles.css`.
- Change how cards or quizzes are built in `app.js` — see `buildPack()`.
- Add more output types by adding a tab in `index.html` and a render function in `app.js`.
