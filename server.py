#!/usr/bin/env python3
"""
StudyAI backend — adapted from the reference backend you supplied.

Reference ideas kept, deliberately:
  * Groq via an OpenAI-compatible endpoint:
        base_url = https://api.groq.com/openai/v1
        model    = openai/gpt-oss-120b
        key      = GROQ_API_KEY (from environment or a .env file)
  * ask_ai() truncates the prompt (24000 chars in the reference) and
    caps output tokens (1500 in the reference), so a small Groq
    account is not blown up by one long document.
  * parse_json() strips ```json fences, then falls back to finding
    the first {...} / [...] block — exactly the reference helper.
  * format_papers() / search_papers() — arXiv, top 3, title/authors/
    abstract only. Here it uses arXiv's public export API over
    stdlib HTTP, so no `arxiv` pip package is required.
  * Compact history: only the last 3 clarification rounds are sent
    back to the model, as in the reference's experiment history.

Changes made to make it more usable:
  * No pip dependencies at all (stdlib only). Run: python3 backend/server.py
  * It also serves the frontend (index.html / app.js / styles.css),
    so one command gives you the full app at http://localhost:8000
  * New flow the frontend now enforces:
        1. /api/search    — Wikipedia + arXiv. If the material is thin,
           it returns clarifying questions instead of junk tools.
        2. /api/confirm   — AI summary + key points + sources, for the
           user to acknowledge BEFORE any tools are made.
        3. /api/generate  — refuses unless confirmed=true, then makes
           flashcards / slides / quiz / guide / expert / spark notes.
           Without GROQ_API_KEY it uses the same built-in generator
           the static frontend used, so the app still works offline.
  * GitHub Pages cannot run Python, so for Pages you host this file
    separately (Render / Railway / Fly.io / a VPS — see README) and
    put its URL in the app's "Backend URL" setting. The static
    fallback in app.js still works with no backend at all.
"""
import datetime
import json
import os
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

# --- config, mirroring the reference ---------------------------------------
def _load_dotenv():
    env_file = Path(__file__).resolve().parent / ".env"
    if not env_file.exists():
        env_file = Path(__file__).resolve().parent.parent / ".env"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

_load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
BASE_URL = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-120b")
PORT = int(os.getenv("PORT", "8000"))
ROOT = Path(__file__).resolve().parent.parent

# --- LLM, adapted from ask_scientist() --------------------------------------
def ask_ai(prompt, max_output_tokens=1500):
    """Return model text, or '' if no key / the call fails (caller falls back)."""
    if not GROQ_API_KEY:
        return ""
    # Absolute safety limit from the reference.
    prompt = prompt[:24000]
    body = json.dumps({
        "model": MODEL,
        "input": prompt,
        "max_output_tokens": max_output_tokens,
    }).encode()
    req = urllib.request.Request(
        BASE_URL.rstrip("/") + "/responses", data=body,
        headers={"Content-Type": "application/json",
                 "Authorization": f"Bearer {GROQ_API_KEY}"},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
    except Exception:
        # Groq also supports the chat endpoint; try that once.
        try:
            body = json.dumps({
                "model": MODEL,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": max_output_tokens,
            }).encode()
            req = urllib.request.Request(
                BASE_URL.rstrip("/") + "/chat/completions", data=body,
                headers={"Content-Type": "application/json",
                         "Authorization": f"Bearer {GROQ_API_KEY}"},
                method="POST")
            with urllib.request.urlopen(req, timeout=60) as resp:
                data = json.loads(resp.read())
            return data["choices"][0]["message"]["content"]
        except Exception:
            return ""
    if isinstance(data, dict) and data.get("output_text"):
        return data["output_text"]
    # responses API shape: output[].content[].text
    texts = []
    for item in data.get("output", []) or []:
        for part in item.get("content", []) or []:
            if part.get("text"):
                texts.append(part["text"])
    return "".join(texts)

# --- JSON helper, from the reference ----------------------------------------
def parse_json(result):
    cleaned = str(result).replace("```json", "").replace("```", "").strip()
    try:
        return json.loads(cleaned)
    except Exception:
        pass
    for start_ch, end_ch in (("{", "}"), ("[", "]")):
        start, end = cleaned.find(start_ch), cleaned.rfind(end_ch)
        if start >= 0 and end > start:
            try:
                return json.loads(cleaned[start:end + 1])
            except Exception:
                pass
    raise ValueError("The AI returned invalid JSON:\n" + cleaned[:2000])

# --- Literature: Wikipedia + arXiv -------------------------------------------
def _http_get(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": "StudyAI/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "ignore")

def search_wikipedia(query):
    try:
        q = urllib.parse.quote(query)
        summary = json.loads(_http_get(
            f"https://en.wikipedia.org/api/rest_v1/page/summary/{q}"))
        search = json.loads(_http_get(
            "https://en.wikipedia.org/w/api.php?action=query&list=search"
            f"&srsearch={q}&format=json&origin=*&srlimit=5"))
        results = []
        if summary.get("extract"):
            results.append({"title": summary.get("title", query),
                            "url": summary.get("content_urls", {}).get("desktop", {}).get("page", ""),
                            "abstract": summary.get("extract", "")[:1000],
                            "source": "Wikipedia"})
        for r in (search.get("query", {}).get("search", []) or []):
            results.append({"title": r["title"],
                            "url": "https://en.wikipedia.org/wiki/" + urllib.parse.quote(r["title"]),
                            "abstract": re.sub("<[^>]+>", "", r.get("snippet", "")),
                            "source": "Wikipedia"})
        return results
    except Exception:
        return []

def search_papers(query, max_results=3):
    """Reference search_papers(), via arXiv's public API (no pip package)."""
    try:
        q = urllib.parse.quote(query)
        xml = _http_get(
            f"https://export.arxiv.org/api/query?search_query=all:{q}"
            f"&start=0&max_results={max_results}&sortBy=relevance")
        ns = {"a": "http://www.w3.org/2005/Atom"}
        root = ET.fromstring(xml)
        papers = []
        for entry in root.findall("a:entry", ns):
            title = (entry.findtext("a:title", "", ns) or "").strip()
            authors = [a.findtext("a:name", "", ns) for a in
                       entry.findall("a:author", ns)][:5]
            papers.append({
                "title": title[:300], "authors": authors,
                "abstract": re.sub(r"\s+", " ", entry.findtext("a:summary", "", ns) or "").strip()[:1000],
                "url": entry.findtext("a:id", "", ns),
                "published": entry.findtext("a:published", "", ns),
                "source": "arXiv",
            })
        return papers
    except Exception:
        return []

def format_papers(papers):
    if not papers:
        return "No literature found."
    out = []
    for i, p in enumerate(papers[:3]):
        out.append(f"\nPAPER {i + 1}\nTitle: {p.get('title', '')[:300]}"
                   f"\nAuthors: {', '.join(p.get('authors', []))}"
                   f"\nAbstract: {p.get('abstract', '')[:1000]}")
    return "\n".join(out)

# --- Clarification + confirmation ---------------------------------------------
STOP = set("the of and for with that this from into when which their there about after before between through during under over also more most other than then been being have has will would should can could study topic important example often usually while".split())

def _sentences(text):
    text = re.sub(r"\s+", " ", text or "")
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text)
            if 35 < len(s.strip()) < 320]

def _key_terms(text):
    counts = {}
    for w in re.sub(r"[^a-z0-9\s-]", " ", (text or "").lower()).split():
        if len(w) > 3 and w not in STOP:
            counts[w] = counts.get(w, 0) + 1
    return [w for w, _ in sorted(counts.items(), key=lambda kv: -kv[1])[:24]]

def clarifying_questions(topic, notes, history):
    """If results are thin, ask more questions instead of guessing."""
    fallback = [
        f"What exactly about {topic} do you need to study — a definition, a process, a proof, or an exam topic?",
        f"Is {topic} for school, university, or a professional exam, and what level should the material be?",
        "What is the one sub-topic or question you are most unsure about?",
        "Do you have a textbook chapter, lecture slides, or a past paper you can paste or upload?",
    ]
    if not GROQ_API_KEY:
        return fallback
    # Compact history: last 3 rounds only, as in the reference.
    compact = [{"q": h.get("q", ""), "a": (h.get("a", "") or "")[:500]}
               for h in (history or [])[-3:]]
    prompt = f"""You are a study tutor. The user wants to study: {topic[:1000]}
Their notes so far: {(notes or '')[:1000]}
Previous clarification rounds: {json.dumps(compact)}
Search results were too thin to build reliable study tools.
Ask exactly 3 short, specific follow-up questions that would let you find
the right material. Return ONLY JSON: ["question 1", "question 2", "question 3"]"""
    try:
        parsed = parse_json(ask_ai(prompt))
        if isinstance(parsed, list) and parsed:
            return [str(x) for x in parsed[:4]]
    except Exception:
        pass
    return fallback

def confirm_material(topic, source_text, results):
    """The acknowledgement step: what the AI understood, before any tools."""
    sents = _sentences(source_text)
    summary = " ".join(sents[:3]) if sents else source_text[:500]
    ai_summary = ""
    if GROQ_API_KEY:
        ai_summary = ask_ai(
            f"Read this study material about {topic[:1000]} and write a 3-sentence "
            f"summary a student can check for correctness. Material:\n{source_text[:8000]}")
    return {
        "topic": topic,
        "ai_acknowledgement": (
            f"I found material on '{topic}' from {len(results)} source(s). "
            f"Here is what I understood — please confirm it is correct before "
            f"I build flashcards, quizzes or notes from it."
        ),
        "summary": ai_summary or summary,
        "key_points": sents[:6],
        "key_terms": _key_terms(source_text)[:10],
        "sources": [{"title": r.get("title", ""), "url": r.get("url", ""),
                     "source": r.get("source", "")} for r in results],
    }

# --- Built-in generator (used when no Groq key) ------------------------------
def build_pack(topic, source_text, level):
    sents = _sentences(source_text) or [
        f"{topic} is a topic worth studying in depth. Start by defining its "
        "key terms, understanding its main processes, and testing yourself regularly."]
    terms = _key_terms(source_text)
    cards = []
    for s in sents:
        m = re.match(r"^(.{3,60}?)\s+(is|are|refers to|means)\s+(.+)$", s, re.I)
        if m and len(cards) < 12:
            cards.append({"q": f"What is {m.group(1).strip()}?", "a": s})
        elif len(cards) < 12:
            cards.append({"q": f"Explain this in your own words: {s[:70]}…", "a": s})
    slides = [
        {"t": topic, "b": [f"Level: {level}", "Flashcards, quiz, guide and notes inside"]},
        {"t": "Overview", "b": sents[:3]},
        {"t": "Key concepts", "b": terms[:5]},
        {"t": "How it works, step by step", "b": sents[3:6] or ["Break the topic into parts", "Learn each part in order", "Connect the parts together"]},
        {"t": "Key takeaways", "b": sents[:3]},
        {"t": "Test yourself", "b": ["Try the flashcards first, without looking", "Then take the quiz", "Revisit anything marked 'Still learning'"]},
    ]
    quiz = []
    for i, s in enumerate(sents[:8]):
        words = s.split()
        idx = next((j for j, w in enumerate(words)
                    if len(w) > 4 and re.sub(r"[^a-z]", "", w.lower()) not in STOP), -1)
        if idx < 0:
            continue
        answer = re.sub(r"[^A-Za-z-]", "", words[idx])
        distractors = [t for t in terms if t.lower() != answer.lower()][:3]
        if len(distractors) < 3:
            continue
        import random
        opts = sorted([answer] + distractors, key=lambda _: random.random())
        blanked = words[:]; blanked[idx] = "______"
        quiz.append({"q": f"{i + 1}. {' '.join(blanked)}",
                     "opts": [w.capitalize() for w in opts], "answer": answer.capitalize()})
    guide = (f"# {topic} — Study Guide ({level})\n\n## Big picture\n{sents[0]}\n\n"
             f"## Key terms\n" + "\n".join(f"- {t}" for t in terms[:10]) +
             "\n\n## Main ideas\n" + "\n".join(f"- {s}" for s in sents) +
             "\n\n## 30-minute plan\n1. Read the Spark Notes (5 min). "
             "2. Flashcards without notes (10 min). 3. Quiz, re-study misses (10 min). "
             "4. Explain it aloud in 2 minutes (5 min).")
    expert = ("# Expert solutions — " + topic + "\n\n**Method:** 1) Restate the question. "
              "2) Pick the fitting concept. 3) Work one labelled step at a time. "
              "4) Check the answer a second way. 5) Note what to do differently next time.\n\n"
              f"**Worked example:** {sents[0]}\n\n**Common pitfalls:** memorising words "
              "without explaining them, skipping the check step, and only revising what you already know.")
    spark = (f"# {topic} — Spark Notes\n\n**In 60 seconds:** {' '.join(sents[:2])}\n\n"
             f"**Key concepts:** {', '.join(terms[:8])}\n\n**Quick facts:**\n" +
             "\n".join(f"- {s}" for s in sents[:5]))
    return {"flashcards": cards, "slides": slides, "quiz": quiz,
            "guide": guide, "expert": expert, "spark": spark}

def generate_with_ai(topic, source_text, level, outputs):
    """One Groq call per output type, so each stays inside the token cap."""
    out = {}
    for kind in outputs:
        prompt = (f"You are a study tutor. Topic: {topic[:1000]}. Level: {level}. "
                  f"Material:\n{source_text[:8000]}\n\n")
        if kind == "flashcards":
            prompt += ("Return ONLY JSON: a list of up to 12 objects "
                       '{"q": "question", "a": "answer"}.')
        elif kind == "quiz":
            prompt += ("Return ONLY JSON: a list of up to 8 objects "
                       '{"q": "question with ______ blank", "opts": ["A","B","C","D"], "answer": "correct option"}.')
        elif kind == "slides":
            prompt += ("Return ONLY JSON: a list of up to 6 objects "
                       '{"t": "slide title", "b": ["bullet", "bullet"]}.')
        else:
            prompt += f"Write the {kind} as clear Markdown for a student."
        try:
            text = ask_ai(prompt)
            out[kind] = parse_json(text) if kind in ("flashcards", "quiz", "slides") else text
        except Exception:
            out[kind] = None
    return out

# --- HTTP ---------------------------------------------------------------------
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(ROOT), **kw)

    def _json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        try:
            return json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0) or 0)) or b"{}")
        except Exception:
            return {}

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path.startswith("/api/health"):
            return self._json({"ok": True, "groq_configured": bool(GROQ_API_KEY), "model": MODEL})
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/search"):
            data = self._body()
            topic = (data.get("topic") or "").strip()
            notes = data.get("notes") or ""
            answers = data.get("answers") or []
            history = data.get("history") or []
            if answers:
                notes = (notes + "\n" + "\n".join(f"Clarification answer: {a}" for a in answers)).strip()
            wiki = search_wikipedia(topic) if topic else []
            papers = search_papers(topic) if topic else []
            results = wiki + papers
            source_text = "\n\n".join([notes] + [r.get("abstract", "") for r in results])
            # Thin material? Ask more questions instead of making tools.
            sufficient = bool(notes and len(notes) > 400) or (
                len(source_text) > 300 and len(results) >= 1)
            if not sufficient:
                return self._json({
                    "sufficient": False,
                    "results": results,
                    "source_text": source_text,
                    "reason": "I did not find enough reliable material on that topic yet.",
                    "clarifying_questions": clarifying_questions(topic, notes, history),
                })
            return self._json({
                "sufficient": True, "results": results,
                "source_text": source_text,
                "confirmation": confirm_material(topic, source_text, results),
            })

        if self.path.startswith("/api/confirm"):
            data = self._body()
            return self._json(confirm_material(
                data.get("topic", ""), data.get("source_text", ""),
                data.get("results", [])))

        if self.path.startswith("/api/generate"):
            data = self._body()
            # The rule the user asked for: no tools before acknowledgement.
            if not data.get("confirmed"):
                return self._json({
                    "error": "material_not_confirmed",
                    "message": "Please confirm the material is correct first (call /api/confirm, then confirm).",
                    "confirmation": confirm_material(
                        data.get("topic", ""), data.get("source_text", ""),
                        data.get("results", [])),
                }, status=400)
            topic = data.get("topic", "Your topic")
            source_text = data.get("source_text", "")
            level = data.get("level", "College / general")
            outputs = data.get("outputs") or ["flashcards", "slides", "quiz", "guide", "expert", "spark"]
            pack = build_pack(topic, source_text, level)
            if GROQ_API_KEY:
                ai = generate_with_ai(topic, source_text, level, outputs)
                # AI output wins where it parsed; built-in fills any gaps.
                if isinstance(ai.get("flashcards"), list) and ai["flashcards"]:
                    pack["flashcards"] = ai["flashcards"]
                if isinstance(ai.get("slides"), list) and ai["slides"]:
                    pack["slides"] = ai["slides"]
                if isinstance(ai.get("quiz"), list) and ai["quiz"]:
                    pack["quiz"] = ai["quiz"]
                for k in ("guide", "expert", "spark"):
                    if ai.get(k):
                        pack[k] = ai[k]
            return self._json({"confirmed": True, "pack": pack,
                               "ai_used": bool(GROQ_API_KEY)})
        return self._json({"error": "not_found"}, status=404)

if __name__ == "__main__":
    print(f"StudyAI backend at http://localhost:{PORT}  "
          f"(Groq configured: {bool(GROQ_API_KEY)}, model: {MODEL})")
    print("Open http://localhost:8000 — the backend also serves the frontend.")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
