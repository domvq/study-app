// StudyAI frontend — new flow:
//   1. Search → 2. Clarify if thin → 3. Confirm material → 4. Generate tools
// Backend (backend/server.py) is used when available; otherwise the
// built-in generator + Wikipedia search run in the browser, with the
// same clarification / confirmation steps enforced locally.
const $ = (id) => document.getElementById(id);
const STOP = new Set("the,of,and,for,with,that,this,from,into,when,which,their,there,about,after,before,between,through,during,under,over,also,more,most,other,than,then,been,being,have,has,will,would,should,can,could,study,topic,important,example,often,usually,while".split(","));
let state = { topic:"", source:"", results:[], confirmation:null, confirmed:false,
  cards:[], slides:[], quiz:[], guide:"", expert:"", spark:"",
  cardIdx:0, flipped:false, slideIdx:0, known:new Set(), learning:new Set(),
  clarifyHistory:[], extraNotes:"" };

function setStatus(msg){ const s=$("status"); s.hidden=!msg; s.textContent=msg||""; }
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function sentences(text){ return (text||"").replace(/\s+/g," ").split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length>35 && s.length<320); }
function keyTerms(text){ const c={}; (text||"").toLowerCase().replace(/[^a-z0-9\s-]/g," ").split(/\s+/).forEach(w=>{ if(w.length>3 && !STOP.has(w)) c[w]=(c[w]||0)+1; }); return Object.entries(c).sort((a,b)=>b[1]-a[1]).slice(0,24).map(e=>e[0]); }
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }
function mdToHtml(md){
  const lines = esc(md||"").split("\n");
  let html="", inList=false;
  const close=()=>{ if(inList){ html+="</ul>"; inList=false; } };
  lines.forEach(line=>{
    if(/^#{1,3}\s+/.test(line)){ close(); html+=`<h3>${line.replace(/^#{1,3}\s+/,"")}</h3>`; }
    else if(/^\s*[-*]\s+/.test(line)){ if(!inList){ html+="<ul>"; inList=true; } html+=`<li>${line.replace(/^\s*[-*]\s+/,"")}</li>`; }
    else if(/^\s*\d+[.)]\s+/.test(line)){ if(!inList){ html+="<ol>"; inList=true; } html+=`<li>${line.replace(/^\s*\d+[.)]\s+/,"")}</li>`; }
    else if(line.trim()){ close(); html+=`<p>${line}</p>`; }
  });
  close();
  return html.replace(/\*\*([^*]+)\*\*/g,"<strong>$1</strong>");
}

// ---------- Backend helper ----------
function backendBase(){ return ($("backendUrl").value||"").trim().replace(/\/$/,""); }
async function api(path, payload){
  const res = await fetch(backendBase()+path, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
  const data = await res.json().catch(()=>({}));
  if(!res.ok) throw Object.assign(new Error(data.message||"Backend error"), {data, status:res.status});
  return data;
}

// ---------- Input / upload ----------
$("sampleBtn").onclick = () => {
  $("topic").value = "Photosynthesis";
  $("notes").value = "Photosynthesis is the process by which green plants convert sunlight, water and carbon dioxide into glucose and oxygen. It takes place mainly in chloroplasts, using the pigment chlorophyll. The light-dependent reactions split water and release oxygen, while the Calvin cycle uses ATP and NADPH to build sugars. Photosynthesis is essential for nearly all life on Earth because it produces oxygen and forms the base of most food chains.";
  setStatus("Sample loaded — Photosynthesis. Press Search & check material.");
};
$("fileInput").addEventListener("change", async (e)=>{
  const f=e.target.files[0]; if(!f) return;
  $("fileName").textContent = f.name;
  try{
    let text="";
    if(f.name.toLowerCase().endsWith(".pdf")){
      if(!window.pdfjsLib){ $("uploadStatus").textContent="PDF reader failed to load — try a .txt file."; return; }
      pdfjsLib.GlobalWorkerOptions.workerSrc="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      const buf=await f.arrayBuffer(); const pdf=await pdfjsLib.getDocument({data:buf}).promise;
      for(let i=1;i<=pdf.numPages;i++){ const p=await pdf.getPage(i); const c=await p.getTextContent(); text+=c.items.map(x=>x.str).join(" ")+"\n"; }
    } else { text=await f.text(); }
    $("notes").value=text.slice(0,20000);
    if(!$("topic").value) $("topic").value=f.name.replace(/\.[^.]+$/,"").replace(/[-_]/g," ");
    $("uploadStatus").textContent=`Loaded ${f.name} (${text.length.toLocaleString()} characters).`;
  }catch(err){ $("uploadStatus").textContent="Could not read that file: "+err.message; }
});

// ---------- Step 1+2: Search, clarify if thin ----------
async function localSearch(topic){
  const q=encodeURIComponent(topic);
  try{
    const res=await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&origin=*&srlimit=5`);
    const data=await res.json();
    const sumRes=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${q}`);
    const sum=sumRes.ok?await sumRes.json():null;
    const results=[];
    if(sum?.extract) results.push({title:sum.title, url:sum.content_urls?.desktop?.page||"", abstract:sum.extract, source:"Wikipedia"});
    (data.query?.search||[]).forEach(r=>results.push({title:r.title, url:"https://en.wikipedia.org/wiki/"+encodeURIComponent(r.title), abstract:r.snippet.replace(/<[^>]+>/g,""), source:"Wikipedia"}));
    return results;
  }catch{ return []; }
}
function localConfirm(topic, source, results){
  const sents=sentences(source);
  return { ai_acknowledgement:`I found material on '${topic}' from ${results.length} source(s). Here is what I understood — please confirm it is correct before I build flashcards, quizzes or notes from it.`,
    summary:sents.slice(0,3).join(" ")||source.slice(0,500), key_points:sents.slice(0,6), key_terms:keyTerms(source).slice(0,10),
    sources:results.map(r=>({title:r.title, url:r.url, source:r.source})) };
}
function showSearch(results){
  $("searchResults").hidden=false;
  $("searchBox").innerHTML = results.length
    ? results.map(r=>`<p><a href="${esc(r.url)}" target="_blank" rel="noopener"><strong>${esc(r.title)}</strong></a> <span class="muted small">(${esc(r.source||"")})</span><br>${esc((r.abstract||"").slice(0,400))}</p>`).join("")
    : "<p>No search results found yet.</p>";
}
function showClarify(questions, reason){
  $("clarifyReason").textContent = reason||"I did not find enough reliable material on that topic yet.";
  $("clarifyBox").innerHTML = questions.map((q,i)=>`<div class="clarify-q"><label>${esc(q)}</label><textarea class="clarify-answer" rows="2" data-i="${i}"></textarea></div>`).join("");
  $("clarifySection").hidden=false; $("confirmSection").hidden=true; $("results").hidden=true;
  $("clarifySection").scrollIntoView({behavior:"smooth"});
}
function showConfirm(conf){
  state.confirmation=conf; state.confirmed=false;
  $("aiAck").textContent=conf.ai_acknowledgement||"Here is the material I will use. Please confirm it is correct.";
  $("confirmSummary").textContent=conf.summary||"";
  $("confirmPoints").innerHTML=(conf.key_points||[]).map(p=>`<li>${esc(p)}</li>`).join("");
  $("confirmSources").innerHTML=(conf.sources||[]).map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a> (${esc(s.source||"")})</li>`).join("")||"<li>Your own notes / upload</li>";
  $("confirmSection").hidden=false; $("clarifySection").hidden=true;
  $("confirmSection").scrollIntoView({behavior:"smooth"});
}

$("checkBtn").onclick = async ()=>{
  const topic=$("topic").value.trim(); const notes=$("notes").value.trim();
  if(!topic && !notes){ setStatus("Type a topic or paste/upload notes first."); return; }
  state.topic=topic||"Your topic"; state.confirmed=false; $("results").hidden=true;
  setStatus("Searching Wikipedia and arXiv, and checking whether the material is enough…");
  // Try the backend first — it enforces the same flow server-side.
  try{
    const data=await api("/api/search", {topic, notes:notes+"\n"+state.extraNotes, history:state.clarifyHistory});
    state.source=data.source_text; state.results=data.results||[];
    showSearch(state.results);
    if(!data.sufficient){
      showClarify(data.clarifying_questions||[], data.reason);
      setStatus("Results were thin, so I'm asking follow-up questions instead of guessing.");
      return;
    }
    showConfirm(data.confirmation); setStatus("Search done. Please confirm the material below before any tools are generated.");
    return;
  }catch(err){
    // No backend (e.g. GitHub Pages static mode): do the same steps locally.
    const results=topic?await localSearch(topic):[];
    const source=[notes, state.extraNotes, ...results.map(r=>r.abstract)].filter(Boolean).join("\n\n");
    state.source=source; state.results=results; showSearch(results);
    const sufficient = (notes.length>400) || (source.length>300 && results.length>=1);
    if(!sufficient){
      showClarify([
        `What exactly about ${topic} do you need to study — a definition, a process, a proof, or an exam topic?`,
        `Is ${topic} for school, university, or a professional exam, and what level should the material be?`,
        "What is the one sub-topic or question you are most unsure about?",
        "Do you have a textbook chapter, lecture slides, or a past paper you can paste or upload?",
      ], "I did not find enough reliable material on that topic yet.");
      setStatus("No backend reachable, so I used the built-in search. Results were thin — please answer the follow-ups.");
      return;
    }
    showConfirm(localConfirm(state.topic, source, results));
    setStatus("Search done (built-in mode). Please confirm the material below before any tools are generated.");
  }
};

$("answerBtn").onclick = async ()=>{
  const answers=[...document.querySelectorAll(".clarify-answer")].map(t=>t.value.trim()).filter(Boolean);
  if(!answers.length){ setStatus("Answer at least one follow-up question, or use 'Use my notes anyway'."); return; }
  state.clarifyHistory.push({q:"clarification round", a:answers.join(" ")});
  state.extraNotes += "\n" + answers.join("\n");
  $("notes").value = ($("notes").value + "\n" + answers.join("\n")).trim();
  $("clarifySection").hidden=true;
  $("checkBtn").onclick();
};
$("skipClarifyBtn").onclick = ()=>{
  $("clarifySection").hidden=true;
  showConfirm(localConfirm(state.topic, state.source, state.results));
  setStatus("Using your notes as-is. Please confirm the material below before any tools are generated.");
};
$("editBtn").onclick = ()=>{ $("confirmSection").hidden=true; $("studio").scrollIntoView({behavior:"smooth"}); $("topic").focus(); };

// ---------- Step 3: Generate — only after confirmation ----------
function buildPack(topic, source, level){
  const sents=sentences(source); const terms=keyTerms(source);
  const base = sents.length? sents : [`${topic} is a topic worth studying in depth. Start by defining its key terms, understanding its main processes, and testing yourself regularly.`];
  const cards=[];
  base.forEach(s=>{
    const m=s.match(/^(.{3,60}?)\s+(is|are|refers to|means)\s+(.+)$/i);
    if(m && cards.length<12) cards.push({q:`What is ${m[1].trim()}?`, a:cap(s)});
    else if(cards.length<12) cards.push({q:`Explain this in your own words: ${s.slice(0,70)}…`, a:cap(s)});
  });
  const slides=[
    {t:topic, b:[`Level: ${level}`, "A complete study pack: flashcards, quiz, guide and notes"]},
    {t:"Overview", b:base.slice(0,3)},
    {t:"Key concepts", b:terms.slice(0,5).map(cap)},
    {t:"How it works, step by step", b:base.slice(3,6).length?base.slice(3,6):["Break the topic into parts","Learn each part in order","Connect the parts together"]},
    {t:"Key takeaways", b:base.slice(0,3)},
    {t:"Test yourself", b:["Try the flashcards first, without looking","Then take the quiz","Revisit anything you marked 'Still learning'"]},
  ];
  const quiz=[];
  base.slice(0,8).forEach((s,i)=>{
    const words=s.split(" "); const cand=words.findIndex(w=>w.length>4 && !STOP.has(w.toLowerCase().replace(/[^a-z]/g,"")));
    if(cand<0) return;
    const answer=words[cand].replace(/[^A-Za-z-]/g,"");
    const distractors=terms.filter(t=>t.toLowerCase()!==answer.toLowerCase()).slice(0,3);
    if(distractors.length<3) return;
    const opts=[answer,...distractors].map(cap).sort(()=>Math.random()-0.5);
    const blanked=[...words]; blanked[cand]="______";
    quiz.push({q:`${i+1}. ${blanked.join(" ")}`, opts, answer:cap(answer)});
  });
  const guide=`# ${topic} — Study Guide (${level})\n\n## Big picture\n${base[0]}\n\n## Key terms\n${terms.slice(0,10).map(t=>`- ${t}`).join("\n")}\n\n## Main ideas\n${base.map(s=>`- ${s}`).join("\n")}\n\n## 30-minute plan\n- Read the Spark Notes (5 min).\n- Flashcards without notes (10 min).\n- Quiz, re-study misses (10 min).\n- Explain it aloud in 2 minutes (5 min).`;
  const expert=`# Expert solutions — ${topic}\n\n**Method:** 1) Restate the question. 2) Pick the fitting concept. 3) Work one labelled step at a time. 4) Check the answer a second way. 5) Note what to do differently next time.\n\n**Worked example:** ${base[0]}\n\n**Common pitfalls:**\n- Memorising words without explaining them\n- Skipping the check step\n- Only revising what you already know`;
  const spark=`# ${topic} — Spark Notes\n\n**In 60 seconds:** ${base.slice(0,2).join(" ")}\n\n**Key concepts:** ${terms.slice(0,8).join(", ")}\n\n**Quick facts:**\n${base.slice(0,5).map(s=>`- ${s}`).join("\n")}`;
  return {flashcards:cards, slides, quiz, guide, expert, spark};
}
function renderPack(pack, chosen){
  state.cards=pack.flashcards||[]; state.slides=pack.slides||[]; state.quiz=pack.quiz||[];
  state.guide=pack.guide||""; state.expert=pack.expert||""; state.spark=pack.spark||"";
  state.cardIdx=0; state.flipped=false; state.slideIdx=0;
  // Match is a game mode for the flashcards, so it is always available.
  document.querySelectorAll(".tab").forEach(t=>{ t.style.display=(t.dataset.tab==="match" || chosen.includes(t.dataset.tab))?"":"none"; });
  startMatch();
  $("guideBox").innerHTML=mdToHtml(state.guide); $("expertBox").innerHTML=mdToHtml(state.expert); $("sparkBox").innerHTML=mdToHtml(state.spark);
  renderCards(); renderSlide(); renderQuiz();
  $("results").hidden=false;
  const first=chosen[0]||"flashcards";
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===first));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active", p.id==="panel-"+first));
  $("progress").textContent=`${state.cards.length} flashcards • ${state.quiz.length} quiz questions • ${state.slides.length} slides`;
}
$("confirmBtn").onclick = async ()=>{
  state.confirmed=true;
  const chosen=[...document.querySelectorAll("#outputChecks input:checked")].map(x=>x.value);
  setStatus("Confirmed — generating your tools from the confirmed material…");
  try{
    const data=await api("/api/generate", {topic:state.topic, source_text:state.source, results:state.results, level:$("level").value, outputs:chosen, confirmed:true});
    renderPack(data.pack, chosen);
    setStatus(data.ai_used ? "Done! Generated with the Groq backend from your confirmed material." : "Done! Generated from your confirmed material (built-in mode, no AI key).");
  }catch(err){
    if(err.data?.error==="material_not_confirmed" && err.data.confirmation){ showConfirm(err.data.confirmation); setStatus("The backend needs confirmation first — please confirm the material above."); return; }
    // Backend unavailable: built-in generation, but only because the user just confirmed.
    renderPack(buildPack(state.topic, state.source, $("level").value), chosen);
    setStatus("Done! Generated from your confirmed material (built-in mode — backend was not reachable).");
  }
  $("results").scrollIntoView({behavior:"smooth"});
};

// ---------- Match game: speed-run terms vs. answers ----------
let matchState = { tiles:[], selected:null, score:0, streak:0, start:0, timer:null, matched:0 };
function startMatch(){
  clearInterval(matchState.timer);
  const pairs = state.cards.slice(0,6).map((c,i)=>({id:i, q:c.q, a:c.a}));
  const tiles = [];
  pairs.forEach(p=>{ tiles.push({pair:p.id, text:p.q, kind:"q"}); tiles.push({pair:p.id, text:p.a, kind:"a"}); });
  tiles.sort(()=>Math.random()-0.5);
  matchState = { tiles, selected:null, score:0, streak:0, start:0, timer:null, matched:0 };
  $("matchResult").textContent = pairs.length ? `Match ${pairs.length} pairs as fast as you can.` : "Generate a pack first — Match needs flashcards.";
  renderMatch();
}
function renderMatch(){
  $("matchScore").innerHTML = `<strong>Score:</strong> ${matchState.score}`;
  $("matchStreak").innerHTML = `<strong>Streak:</strong> ${matchState.streak}`;
  $("matchGrid").innerHTML = matchState.tiles.map((t,i)=>`<button type="button" class="match-tile ${t.matched?"matched":""} ${matchState.selected===i?"selected":""}" data-i="${i}" ${t.matched?"disabled":""}>${esc(String(t.text).slice(0,140))}</button>`).join("");
  document.querySelectorAll(".match-tile").forEach(el=>el.onclick=()=>{
    const i=Number(el.dataset.i);
    if(!matchState.start){ matchState.start=Date.now(); matchState.timer=setInterval(()=>{ $("matchTimer").innerHTML=`<strong>Time:</strong> ${((Date.now()-matchState.start)/1000).toFixed(1)}s`; },100); }
    if(matchState.selected===null){ matchState.selected=i; renderMatch(); return; }
    const first=matchState.tiles[matchState.selected];
    if(matchState.selected===i){ matchState.selected=null; renderMatch(); return; }
    if(first.pair===matchState.tiles[i].pair){
      first.matched=true; matchState.tiles[i].matched=true; matchState.matched++;
      matchState.score+=10; matchState.streak++;
      matchState.selected=null;
      if(matchState.matched>=matchState.tiles.length/2){
        clearInterval(matchState.timer);
        const secs=((Date.now()-matchState.start)/1000).toFixed(1);
        const best=Number(localStorage.getItem("studyai-match-best")||"0");
        if(!best || secs<best) localStorage.setItem("studyai-match-best", secs);
        $("matchResult").textContent=`🎉 Finished in ${secs}s! Score: ${matchState.score}. Best time: ${localStorage.getItem("studyai-match-best")}s.`;
      }
    } else {
      matchState.streak=0; const bad=matchState.selected; matchState.selected=null;
      renderMatch();
      const els=document.querySelectorAll(".match-tile");
      if(els[bad]) els[bad].classList.add("wrong"); el.classList.add("wrong");
      setTimeout(renderMatch, 500);
      return;
    }
    renderMatch();
  });
}
$("restartMatch").onclick = ()=>startMatch();

// ---------- Tools UI (unchanged behaviour) ----------
function renderCards(){ const c=state.cards[state.cardIdx]; if(!c) return; $("fcText").textContent=state.flipped?c.a:c.q; $("cardCounter").textContent=`Card ${state.cardIdx+1} of ${state.cards.length} • Known: ${state.known.size} • Still learning: ${state.learning.size}`; }
function renderSlide(){ const s=state.slides[state.slideIdx]; if(!s) return; $("slideBox").innerHTML=`<h3>${esc(s.t)}</h3><ul>${s.b.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`; $("slideCounter").textContent=`Slide ${state.slideIdx+1} of ${state.slides.length}`; }
function renderQuiz(){
  $("quizBox").innerHTML=state.quiz.map((q,i)=>`<div class="quiz-q" data-i="${i}"><strong>${esc(q.q)}</strong>${q.opts.map(o=>`<label><input type="radio" name="q${i}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</div>`).join("") || "<p>Not enough source sentences to build a quiz — add more notes or pick a richer topic.</p>";
  $("quizScore").textContent="";
}
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===t));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+t.dataset.tab));
});
$("flashcard").onclick=()=>{ state.flipped=!state.flipped; renderCards(); };
$("flipBtn").onclick=()=>{ state.flipped=!state.flipped; renderCards(); };
$("shuffleBtn").onclick=()=>{ state.cards.sort(()=>Math.random()-0.5); state.cardIdx=0; state.flipped=false; renderCards(); };
$("prevCard").onclick=()=>{ state.cardIdx=(state.cardIdx-1+state.cards.length)%state.cards.length; state.flipped=false; renderCards(); };
$("nextCard").onclick=()=>{ state.cardIdx=(state.cardIdx+1)%state.cards.length; state.flipped=false; renderCards(); };
$("knowBtn").onclick=()=>{ state.known.add(state.cardIdx); state.learning.delete(state.cardIdx); $("nextCard").onclick(); };
$("dontKnowBtn").onclick=()=>{ state.learning.add(state.cardIdx); state.known.delete(state.cardIdx); $("nextCard").onclick(); };
$("prevSlide").onclick=()=>{ state.slideIdx=(state.slideIdx-1+state.slides.length)%state.slides.length; renderSlide(); };
$("nextSlide").onclick=()=>{ state.slideIdx=(state.slideIdx+1)%state.slides.length; renderSlide(); };
$("checkQuiz").onclick=()=>{
  let score=0;
  document.querySelectorAll(".quiz-q").forEach((el,i)=>{
    const sel=el.querySelector("input:checked"); const ok=sel && sel.value===state.quiz[i].answer;
    if(ok) score++; el.classList.toggle("correct",!!ok); el.classList.toggle("wrong",!ok);
    if(!ok){ const note=document.createElement("p"); note.innerHTML=`<strong>Answer:</strong> ${esc(state.quiz[i].answer)}`; el.appendChild(note); }
  });
  $("quizScore").textContent=`Score: ${score} / ${state.quiz.length}`;
};
$("resetQuiz").onclick=()=>{ renderQuiz(); };
$("exportBtn").onclick=()=>{
  const topic=state.topic||"Study pack";
  let md=`# ${topic}\n\n## Flashcards\n`+state.cards.map(c=>`- Q: ${c.q}\n  A: ${c.a}\n`).join("")+`\n## Slides\n`+state.slides.map(s=>`### ${s.t}\n`+s.b.map(b=>`- ${b}\n`).join("")).join("")+`\n## Quiz\n`+state.quiz.map(q=>`- ${q.q}\n  - Options: ${q.opts.join(", ")}\n  - Answer: ${q.answer}\n`).join("")+`\n## Study guide\n${state.guide}\n\n## Expert solutions\n${state.expert}\n\n## Spark Notes\n${state.spark}\n`;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"})); a.download=topic.replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"-study-pack.md"; a.click();
};
$("printBtn").onclick=()=>window.print();
