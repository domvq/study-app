# StudyAI

Turn any topic into a quick study game. Type what you want to study, or upload a document — StudyAI searches first, asks more questions if it can't find enough, and only builds your tools once you've confirmed the material is correct.

## Design

The frontend is designed in the spirit of Quizlet's learning-games page: clean white cards, bold headings, a blue primary with a yellow accent, a “Pick your game” picker, and short, scorable rounds with instant feedback. This is an original implementation, not Quizlet branding or content.

## What it generates (after confirmation)

- **Flashcards** — flip, shuffle, track known vs. still learning
- **Match** — speed-run matching questions to answers, with timer, score, streak, and a best time saved in your browser
- **Quiz** — multiple-choice, with instant scoring
- **Slideshow** — a presentable deck built from your material
- **Study guides** — big picture, key terms, a 30-minute study plan
- **Expert solutions** — step-by-step method, worked example, common pitfalls
- **Spark Notes** — a 60-second summary, themes, and quick facts
- **Export** — the whole pack as Markdown, or print / save as PDF

## Flow (enforced, not optional)

1. **Search** — Wikipedia + arXiv (via the backend when available).
2. **Clarify** — if results are thin, the AI asks follow-up questions instead of guessing. Answer them and it searches again.
3. **Confirm** — the AI shows a summary, key points, and sources. You acknowledge the material is correct.
4. **Generate** — only after confirmation are tools made. The backend's `/api/generate` returns `400 material_not_confirmed` without it.

## Run it locally

### Full app with backend (recommended)

```bash
cp backend/.env.example backend/.env
# add your GROQ_API_KEY to backend/.env (optional — see below)
python3 backend/server.py
# open http://localhost:8000
```

The backend (`backend/server.py`) is modelled on the Groq reference backend: same model (`openai/gpt-oss-120b`), same `GROQ_API_KEY`, same prompt-truncation (24,000 chars) and JSON-cleaning helpers, plus arXiv search and the compact-history idea (last 3 clarification rounds). It needs **no pip packages** — it uses only the Python standard library and serves the frontend too.

Without a key it still works, using the built-in generator. With a key, Groq writes the clarifying questions, the confirmation summary, and the generated tools. See `backend/README.md` for the API.

### Static only

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Or just open `index.html` in a browser (Wikipedia search needs internet). The same clarification / confirmation steps run in the browser.

Your documents never leave your browser unless you use a hosted backend / external AI API.

## Deploy through GitHub (GitHub Pages)

GitHub Pages serves static files only, so it can host the frontend but **not** the Python backend.

### Frontend to Pages (automatic workflow, recommended)

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
   The workflow in `.github/workflows/pages.yml` redeploys on every push to `main`.

### Backend separately (for the Groq / arXiv version)

Host `backend/server.py` on Render, Railway, Fly.io, or a VPS (start command `python3 backend/server.py`, env `GROQ_API_KEY` + `PORT`), then paste its URL into the app's “Backend URL” setting. If it is unreachable, the app falls back to built-in mode.

## Files

| File | What it does |
| --- | --- |
| `index.html` | Page structure, input, search / clarify / confirm steps, game picker |
| `styles.css` | Quizlet-inspired game-card design |
| `app.js` | Search, clarify, confirm, and all generators + the Match game |
| `backend/server.py` | Groq-modelled backend: search, clarify, confirm, generate |
| `backend/.env.example`, `backend/README.md` | Backend config and API docs |
| `.github/workflows/pages.yml` | GitHub Pages deploy on push to `main` |

## Customising

- Change colours / layout in `styles.css`.
- Change how cards or quizzes are built in `app.js` — see `buildPack()` — or in `backend/server.py` — see `build_pack()`.
- Add more game modes by adding a tab in `index.html` and a render function in `app.js`.
