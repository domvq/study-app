// StudyAI — static, no backend required.
// Built-in generator + Wikipedia search work with no API key.
// An optional OpenAI-compatible key (Settings) is used only to enrich the summary, if supplied.
const $ = (id) => document.getElementById(id);
const STOP = new Set("the,of,and,for,with,that,this,from,into,when,which,their,there,about,after,before,between,through,during,under,over,also,more,most,other,than,then,been,being,have,has,will,would,should,can,could,study,topic,important,example,often,usually,while".split(","));
let state = { topic:"", source:"", cards:[], slides:[], quiz:[], cardIdx:0, flipped:false, slideIdx:0, known:new Set(), learning:new Set() };

function setStatus(msg){ const s=$("status"); s.hidden=!msg; s.textContent=msg||""; }
function esc(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function sentences(text){
  return text.replace(/\s+/g," ").split(/(?<=[.!?])\s+/).map(s=>s.trim()).filter(s=>s.length>35 && s.length<320);
}
function keyTerms(text){
  const counts={};
  text.toLowerCase().replace(/[^a-z0-9\s-]/g," ").split(/\s+/).forEach(w=>{
    if(w.length>3 && !STOP.has(w)) counts[w]=(counts[w]||0)+1;
  });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,24).map(e=>e[0]);
}
function cap(s){ return s.charAt(0).toUpperCase()+s.slice(1); }

// ---------- Input / upload ----------
$("sampleBtn").onclick = () => {
  $("topic").value = "Photosynthesis";
  $("notes").value = "Photosynthesis is the process by which green plants convert sunlight, water and carbon dioxide into glucose and oxygen. It takes place mainly in chloroplasts, using the pigment chlorophyll. The light-dependent reactions split water and release oxygen, while the Calvin cycle uses ATP and NADPH to build sugars. Photosynthesis is essential for nearly all life on Earth because it produces oxygen and forms the base of most food chains.";
  setStatus("Sample loaded — Photosynthesis. Press Generate study pack.");
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

// ---------- Web search (Wikipedia, free, no key) ----------
async function searchTopic(topic){
  const box=$("searchBox"); $("searchResults").hidden=false; box.innerHTML="<p>Searching…</p>";
  try{
    const q=encodeURIComponent(topic);
    const res=await fetch(`https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${q}&format=json&origin=*&srlimit=5`);
    const data=await res.json();
    const sumRes=await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${q}`);
    const sum=sumRes.ok?await sumRes.json():null;
    let html="";
    if(sum && sum.extract){ html+=`<h3><a href="${esc(sum.content_urls?.desktop?.page||"https://en.wikipedia.org/wiki/"+q)}" target="_blank" rel="noopener">${esc(sum.title)}</a></h3><p>${esc(sum.extract)}</p>`; }
    (data.query?.search||[]).forEach(r=>{ html+=`<p><a href="https://en.wikipedia.org/wiki/${encodeURIComponent(r.title)}" target="_blank" rel="noopener"><strong>${esc(r.title)}</strong></a> — ${r.snippet.replace(/<[^>]+>/g,"")}</p>`; });
    box.innerHTML=html||"<p>No Wikipedia results found. Your own notes will still be used.</p>";
    return (sum?.extract||"")+" "+(data.query?.search||[]).map(r=>r.title+". "+r.snippet.replace(/<[^>]+>/g,"")).join(" ");
  }catch(err){
    box.innerHTML="<p>Search is unavailable right now (network blocked?). Your own notes will still be used.</p>";
    return "";
  }
}
$("searchOnlyBtn").onclick=async()=>{ const t=$("topic").value.trim(); if(!t){ setStatus("Type a topic first to search."); return; } await searchTopic(t); setStatus("Search done — see Web search results above."); };

// ---------- Optional AI enrichment (only if user supplies a key) ----------
async function aiEnrich(prompt){
  const key=$("apiKey").value.trim(), base=$("apiBase").value.trim().replace(/\/$/,""), model=$("apiModel").value.trim()||"gpt-4o-mini";
  if(!key||!base) return "";
  try{
    const r=await fetch(base+"/chat/completions",{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature:0.4})});
    const d=await r.json(); return d.choices?.[0]?.message?.content||"";
  }catch{ return ""; }
}

// ---------- Generators ----------
function buildPack(topic, source, level){
  const sents=sentences(source); const terms=keyTerms(source);
  const base = sents.length? sents : [`${topic} is a topic worth studying in depth. Start by defining its key terms, understanding its main processes, and testing yourself regularly.`];
  // Flashcards: "X is Y" -> Q: What is X?
  const cards=[];
  base.forEach(s=>{
    const m=s.match(/^(.{3,60}?)\s+(is|are|refers to|means)\s+(.+)$/i);
    if(m && cards.length<12) cards.push({q:`What is ${m[1].trim()}?`, a:cap(s)});
    else if(cards.length<12) cards.push({q:`Explain this in your own words: ${s.slice(0,70)}…`, a:cap(s)});
  });
  terms.slice(0,6).forEach(t=>{ if(cards.length<14 && !cards.some(c=>c.q.toLowerCase().includes(t))) cards.push({q:`Define: ${t}`, a:`A key term in ${topic}. Use the study guide below to write its definition from the source material, then check it against the search summary.`}); });
  // Slides
  const slides=[
    {t:topic, b:[`Level: ${level}`, "A complete study pack: flashcards, quiz, guide and notes", "Start with the overview, then test yourself."]},
    {t:"Overview", b:base.slice(0,3)},
    {t:"Key concepts", b:terms.slice(0,5).map(t=>cap(t))},
    {t:"How it works, step by step", b:base.slice(3,6).length?base.slice(3,6):["Break the topic into parts","Learn each part in order","Connect the parts together"]},
    {t:"Key takeaways", b:base.slice(0,3).map(s=>"• "+s)},
    {t:"Test yourself", b:["Try the flashcards first, without looking","Then take the quiz","Revisit anything you marked 'Still learning'"]},
  ];
  // Quiz: blank out a term
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
  return {cards, slides, quiz, terms, base};
}
function renderGuide(topic, pack, level){
  $("guideBox").innerHTML=`<h3>${esc(topic)} — Study Guide (${esc(level)})</h3>
  <h3>1. The big picture</h3><p>${esc(pack.base[0]||"")}</p>
  <h3>2. Key terms to master</h3><ul>${pack.terms.slice(0,10).map(t=>`<li><strong>${esc(cap(t))}</strong></li>`).join("")}</ul>
  <h3>3. Main ideas</h3><ul>${pack.base.map(s=>`<li>${esc(s)}</li>`).join("")}</ul>
  <h3>4. How to study this (30 minutes)</h3><ol><li>Read the Spark Notes summary once (5 min).</li><li>Flip through all flashcards without notes (10 min).</li><li>Take the quiz, then re-study only the questions you missed (10 min).</li><li>Explain the topic aloud in 2 minutes, as if teaching a friend (5 min).</li></ol>
  <h3>5. Self-check questions</h3><ul>${pack.cards.slice(0,6).map(c=>`<li>${esc(c.q)}</li>`).join("")}</ul>`;
}
function renderExpert(topic, pack){
  $("expertBox").innerHTML=`<h3>Expert solutions — ${esc(topic)}</h3>
  <p>Expert solutions are not just answers. They show the thinking: what to notice, which method to use, and how to check your work.</p>
  <h3>A reliable method, every time</h3><ol>
  <li><strong>Understand:</strong> restate the question in your own words. What is given? What is asked for?</li>
  <li><strong>Plan:</strong> pick the concept from the key terms that fits — ${esc(pack.terms.slice(0,3).map(cap).join(", ")||"the main concepts")}.</li>
  <li><strong>Work it through:</strong> do one step at a time and label each step, so a mistake is easy to find.</li>
  <li><strong>Check:</strong> does the answer make sense? Try a second, rough way to verify it.</li>
  <li><strong>Reflect:</strong> write one sentence on what you would do differently next time.</li></ol>
  <h3>Worked example (from your source material)</h3><p><strong>Problem:</strong> Explain the main idea of ${esc(topic)} clearly and completely.</p>
  <p><strong>Solution:</strong> ${esc(pack.base[0]||"")}</p>
  <p><strong>Why this works:</strong> it starts with a definition, then adds the mechanism and the reason it matters — definition → process → significance is a structure markers reward.</p>
  <h3>Common pitfalls</h3><ul><li>Memorising words without being able to explain them — use the flashcards both ways.</li><li>Skipping the check step — most lost marks are simple slips, not missing knowledge.</li><li>Studying only what you already know — filter by “Still learning” in the flashcards.</li></ul>
  <h3>Practice with solutions</h3><ol>${pack.cards.slice(0,3).map(c=>`<li>${esc(c.q)}<br><em>Solution:</em> ${esc(c.a)}</li>`).join("")}</ol>`;
}
function renderSpark(topic, pack, aiText){
  $("sparkBox").innerHTML=`<h3>${esc(topic)} — Spark Notes</h3>
  ${aiText?`<p><em>AI enrichment:</em> ${esc(aiText)}</p>`:""}
  <h3>In 60 seconds</h3><p>${esc(pack.base.slice(0,2).join(" "))}</p>
  <h3>Key concepts</h3><ul>${pack.terms.slice(0,8).map(t=>`<li>${esc(cap(t))}</li>`).join("")}</ul>
  <h3>Themes &amp; why it matters</h3><p>${esc(pack.base[1]||pack.base[0]||"")}</p>
  <h3>Quick facts to remember</h3><ul>${pack.base.slice(0,5).map(s=>`<li>${esc(s)}</li>`).join("")}</ul>
  <h3>If you only have 5 minutes</h3><p>Read the “In 60 seconds” paragraph, memorise the key concepts list, and answer the first three flashcards from memory.</p>`;
}
function renderCards(){ const c=state.cards[state.cardIdx]; if(!c) return; $("fcText").textContent=state.flipped?c.a:c.q; $("cardCounter").textContent=`Card ${state.cardIdx+1} of ${state.cards.length} • Known: ${state.known.size} • Still learning: ${state.learning.size}`; }
function renderSlide(){ const s=state.slides[state.slideIdx]; if(!s) return; $("slideBox").innerHTML=`<h3>${esc(s.t)}</h3><ul>${s.b.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`; $("slideCounter").textContent=`Slide ${state.slideIdx+1} of ${state.slides.length}`; }
function renderQuiz(){
  $("quizBox").innerHTML=state.quiz.map((q,i)=>`<div class="quiz-q" data-i="${i}"><strong>${esc(q.q)}</strong>${q.opts.map(o=>`<label><input type="radio" name="q${i}" value="${esc(o)}"> ${esc(o)}</label>`).join("")}</div>`).join("") || "<p>Not enough source sentences to build a quiz — add more notes or pick a richer topic.</p>";
  $("quizScore").textContent="";
}

// ---------- Main generate ----------
$("generateBtn").onclick=async()=>{
  const topic=$("topic").value.trim(); const notes=$("notes").value.trim();
  const chosen=[...document.querySelectorAll("#outputChecks input:checked")].map(x=>x.value);
  if(!topic && !notes){ setStatus("Type a topic or paste/upload notes first."); return; }
  setStatus("Searching and building your study pack…");
  let webText="";
  if(topic) webText=await searchTopic(topic);
  const source=[notes, webText].filter(Boolean).join("\n\n").slice(0,30000);
  const level=$("level").value;
  const pack=buildPack(topic||"Your topic", source, level);
  state.cards=pack.cards; state.slides=pack.slides; state.quiz=pack.quiz; state.cardIdx=0; state.flipped=false; state.slideIdx=0;
  // Only show tabs the user checked; others stay hidden in the tab bar for clarity
  document.querySelectorAll(".tab").forEach(t=>{ t.style.display=chosen.includes(t.dataset.tab)?"":"none"; });
  const aiText=await aiEnrich(`Summarise ${topic||"this material"} for a student in 120 words, based on: ${source.slice(0,3000)}`);
  renderGuide(topic||"Your topic", pack, level); renderExpert(topic||"Your topic", pack); renderSpark(topic||"Your topic", pack, aiText);
  renderCards(); renderSlide(); renderQuiz();
  $("results").hidden=false;
  // Activate first chosen tab
  const first=chosen[0]||"flashcards";
  document.querySelectorAll(".tab").forEach(t=>t.classList.toggle("active", t.dataset.tab===first));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active", p.id==="panel-"+first));
  $("progress").textContent=`${pack.cards.length} flashcards • ${pack.quiz.length} quiz questions • ${pack.slides.length} slides`;
  setStatus("Done! Use the tabs above. Export the pack as Markdown if you want to keep it.");
  document.getElementById("results").scrollIntoView({behavior:"smooth"});
  localStorage.setItem("studyai-last", JSON.stringify({topic, source:source.slice(0,5000)}));
};

// Tabs
document.querySelectorAll(".tab").forEach(t=>t.onclick=()=>{
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x===t));
  document.querySelectorAll(".panel").forEach(p=>p.classList.toggle("active",p.id==="panel-"+t.dataset.tab));
});
// Flashcards
$("flashcard").onclick=()=>{ state.flipped=!state.flipped; renderCards(); };
$("flipBtn").onclick=()=>{ state.flipped=!state.flipped; renderCards(); };
$("shuffleBtn").onclick=()=>{ state.cards.sort(()=>Math.random()-0.5); state.cardIdx=0; state.flipped=false; renderCards(); };
$("prevCard").onclick=()=>{ state.cardIdx=(state.cardIdx-1+state.cards.length)%state.cards.length; state.flipped=false; renderCards(); };
$("nextCard").onclick=()=>{ state.cardIdx=(state.cardIdx+1)%state.cards.length; state.flipped=false; renderCards(); };
$("knowBtn").onclick=()=>{ state.known.add(state.cardIdx); state.learning.delete(state.cardIdx); $("nextCard").onclick(); };
$("dontKnowBtn").onclick=()=>{ state.learning.add(state.cardIdx); state.known.delete(state.cardIdx); $("nextCard").onclick(); };
// Slides
$("prevSlide").onclick=()=>{ state.slideIdx=(state.slideIdx-1+state.slides.length)%state.slides.length; renderSlide(); };
$("nextSlide").onclick=()=>{ state.slideIdx=(state.slideIdx+1)%state.slides.length; renderSlide(); };
// Quiz
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
// Export
$("exportBtn").onclick=()=>{
  const topic=$("topic").value||"Study pack";
  let md=`# ${topic}\n\n## Flashcards\n`+state.cards.map(c=>`- Q: ${c.q}\n  A: ${c.a}\n`).join("")+`\n## Slides\n`+state.slides.map(s=>`### ${s.t}\n`+s.b.map(b=>`- ${b}\n`).join("")).join("")+`\n## Quiz\n`+state.quiz.map(q=>`- ${q.q}\n  - Options: ${q.opts.join(", ")}\n  - Answer: ${q.answer}\n`).join("")+`\n## Study guide\n`+$("guideBox").innerText+`\n\n## Spark Notes\n`+$("sparkBox").innerText;
  const a=document.createElement("a"); a.href=URL.createObjectURL(new Blob([md],{type:"text/markdown"})); a.download=topic.replace(/[^a-z0-9]+/gi,"-").toLowerCase()+"-study-pack.md"; a.click();
};
$("printBtn").onclick=()=>window.print();
