# StudyAI backend

Modelled on your Groq reference backend, adapted for study tools.

## Run (no pip install needed)

```bash
cp backend/.env.example backend/.env
# edit backend/.env and add your GROQ_API_KEY
python3 backend/server.py
# open http://localhost:8000
```

The backend also serves `index.html`, `app.js` and `styles.css`, so that
one command is the whole app.

Without `GROQ_API_KEY` it still works: search + the built-in generator
run, and the clarification / confirmation flow is enforced. With a key,
Groq (`openai/gpt-oss-120b`) writes the clarifying questions, the
confirmation summary, and the generated tools.

## API

- `GET /api/health` — `{ok, groq_configured, model}`
- `POST /api/search` — `{topic, notes, answers?, history?}` →
  `{sufficient, results, source_text, clarifying_questions? | confirmation}`
  If `sufficient` is false, no tools are made — the frontend asks the
  returned follow-up questions and calls search again with answers.
- `POST /api/confirm` — `{topic, source_text, results}` →
  acknowledgement summary, key points and sources for the user to check.
- `POST /api/generate` — `{topic, source_text, results, level, outputs, confirmed}`
  Returns `400 material_not_confirmed` unless `confirmed` is true.
  This is the rule: **no tools before the user confirms the material.**

## Deploy

GitHub Pages serves static files only, so it cannot run this Python
backend. Deploy the frontend to Pages as before, and host this backend
separately, e.g. Render (Web Service, start command
`python3 backend/server.py`, env `GROQ_API_KEY` + `PORT`), Railway,
Fly.io, or a VPS. Then paste the backend URL into the app's
“Backend URL” setting — the frontend will use it, with the built-in
static fallback if it is unreachable.
