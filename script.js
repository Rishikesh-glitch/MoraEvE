
const $=s=>document.querySelector(s);
const iso=d=>{const x=new Date();x.setDate(x.getDate()+d);return x.toISOString().slice(0,10)};
// Fallback events, used until the shared database answers or when it is empty
const SEED=[
 ["Mora Music Night","Lagan",2,1500],["Campus Cultural Fest","Robert Peries",5,0],["Stand-up Comedy Evening","Lagan",9,2000],
 ["Inter-Faculty Cricket Final","Robert Peries",3,500],["Drama: Sinhala Classics","Lagan",20,1200],["Open Mic Friday","Robert Peries",1,0]
].map((e,i)=>({id:"seed"+i,title:e[0],venue:e[1],date:iso(e[2]),price:e[3],sample:true}));
let events=SEED, tickets=[], active=new Set();
let supabaseClient=null, session=null, authMode="signin";

// ---------- back end (Node.js /api/*) ----------
async function call(res,method="GET",body){
  const headers={"Content-Type":"application/json"};
  if(session?.access_token) headers.Authorization="Bearer "+session.access_token;
  const response=await fetch("/api/"+res,{method,headers,body:body?JSON.stringify(body):undefined});
  const result=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(result.error||"The server could not complete the request.");
  return result;
}
async function load(){
  try{
    const ev=await call("events"); if(Array.isArray(ev)) events=ev.length?ev:SEED;
  }catch(e){
    console.error(e);toast("Could not load saved events. Check the server and Supabase setup.");
  }
  render();
}
async function save(res,id,data){ return call(res,"POST",{id,...data}); }
async function loadMyTickets(){
 if(!session) return;
 const userId=session.user.id;
 try{
  const rows=await call("tickets");
  if(session?.user?.id!==userId)return;
  tickets=Array.isArray(rows)?rows:[];
  renderTickets();
 }catch(error){console.error(error);toast("Could not load your tickets.");}
}

// ---------- routing ----------
function route(){
 const h=(location.hash||"#home").slice(1); const v=["home","events","contact"].includes(h)?h:"home";
 ["home","events","contact"].forEach(n=>{$("#v-"+n).classList.toggle("hide",n!==v);$("#n-"+n).classList.toggle("on",n===v)});
 window.scrollTo(0,0);
}
addEventListener("hashchange",route);

// ---------- rendering ----------
const fmt=d=>new Date(d+"T00:00").toLocaleDateString("en-GB",{weekday:"short",day:"numeric",month:"short"});
const inWeek=d=>d>=iso(0)&&d<=iso(7);
function card(e){
 return `<article class="card"><div class="img"><span>${esc(e.venue)}</span><span class="tag">${e.price?"LKR "+e.price:"Free"}</span></div>
 <div class="b"><h3>${esc(e.title)}</h3><p>${fmt(e.date)} · ${esc(e.venue)}</p>${e.organizer?`<p>By ${esc(e.organizer)}</p>`:""}
 <div class="row"><span class="price">${e.price?"LKR "+Number(e.price).toLocaleString():"Free entry"}</span>
 <button class="btn sm" data-reg="${e.id}">${e.price?"Buy tickets":"Enroll"}</button></div></div></article>`;
}
function esc(s){return String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))}
function filtered(){
 const q=$("#q").value.trim().toLowerCase();
 return events.filter(e=>{
  if(q&&!(e.title+" "+e.organizer+" "+e.venue).toLowerCase().includes(q)) return false;
  if(active.has("free")&&e.price>0) return false;
  if(active.has("paid")&&!(e.price>0)) return false;
  if(active.has("Lagan")&&e.venue!=="Lagan") return false;
  if(active.has("Robert Peries")&&e.venue!=="Robert Peries") return false;
  if(active.has("week")&&!inWeek(e.date)) return false;
  return true;
 }).sort((a,b)=>a.date.localeCompare(b.date));
}
function render(){
 const f=filtered();
 $("#list").innerHTML=f.length?f.map(card).join(""):`<div class="empty" style="grid-column:1/-1">No events match. Clear a filter or add your own event.</div>`;
 $("#featured").innerHTML=events.filter(e=>inWeek(e.date)).slice(0,4).map(card).join("")||events.slice(0,4).map(card).join("");
 document.querySelectorAll(".chip").forEach(c=>c.classList.toggle("on",active.has(c.dataset.f)));
}
$("#filters").addEventListener("click",e=>{const c=e.target.closest(".chip");if(!c)return;const f=c.dataset.f;
 // free/payable are exclusive; Lagan/Robert Peries are exclusive
 const groups=[["free","paid"],["Lagan","Robert Peries"]];
 if(active.has(f)) active.delete(f); else{groups.forEach(g=>{if(g.includes(f))g.forEach(x=>active.delete(x))});active.add(f)}
 render();
});

// ---------- search + suggestions ----------
function suggest(){
 const q=$("#q").value.trim().toLowerCase(), box=$("#sug");
 if(!q){box.style.display="none";return}
 const hits=[...new Set(events.flatMap(e=>[e.title,e.organizer,e.venue]).filter(Boolean))].filter(t=>t.toLowerCase().includes(q)).slice(0,5);
 box.innerHTML=hits.map(h=>`<button type="button" data-s="${esc(h)}">${esc(h)}</button>`).join("")||`<button type="button" disabled>No suggestions</button>`;
 box.style.display="block";
}
$("#q").addEventListener("input",()=>{suggest();render()});
$("#sug").addEventListener("click",e=>{const b=e.target.closest("[data-s]");if(!b)return;$("#q").value=b.dataset.s;$("#sug").style.display="none";render()});
$("#qbtn").onclick=()=>{$("#sug").style.display="none";render()};
document.addEventListener("click",e=>{if(!e.target.closest(".sbox"))$("#sug").style.display="none"});
function goSearch(e){e.preventDefault();$("#q").value=$("#hq").value;location.hash="#events";render()}
$("#nav")&&0;
document.querySelector('nav a[href="#events"]');

// ---------- register ----------
function toast(t){const x=$("#toast");x.textContent=t;x.style.display="block";setTimeout(()=>x.style.display="none",2600)}
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>b.closest("dialog").close());
function authNotice(message){$("#authMessage").textContent=message}
function setAuthMode(mode){
 authMode=mode;
 const signingUp=mode==="signup";
 $("#authTitle").textContent=signingUp?"Create your MoraEvE account":"Sign in to MoraEvE";
 $("#authNameWrap").classList.toggle("hide",!signingUp);
 $("#authName").required=signingUp;
 $("#authPassword").autocomplete=signingUp?"new-password":"current-password";
 $("#authSubmit").textContent=signingUp?"Create account":"Sign in";
 $("#authModeToggle").textContent=signingUp?"I already have an account":"Create account";
 authNotice("");
}
function renderAuth(){
 $("#regNav").textContent=session?"Sign out":"Sign in";
 $("#regNav").title=session?.user?.email||"Sign in";
 $("#ticketNav").classList.toggle("hide",!session);
}
function openAuth(message=""){
 setAuthMode("signin");
 authNotice(message);
 $("#authDlg").showModal();
}
$("#regNav").onclick=async()=>{
 if(!session){openAuth();return}
 const {error}=await supabaseClient.auth.signOut();
 if(error){console.error(error);toast("Could not sign out: "+error.message)}
};
$("#authModeToggle").onclick=()=>setAuthMode(authMode==="signup"?"signin":"signup");
$("#authForm").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!supabaseClient){authNotice("Supabase Auth is not configured. Check the app setup.");return}
 const email=$("#authEmail").value.trim(), password=$("#authPassword").value;
 try{
  if(authMode==="signup"){
   const name=$("#authName").value.trim();
   if(!name){authNotice("Enter your name.");return}
   const {data,error}=await supabaseClient.auth.signUp({
    email,password,options:{data:{full_name:name},emailRedirectTo:location.origin}
   });
   if(error) throw error;
   if(!data.session){authNotice("Check your email to confirm your account, then sign in.");return}
  }else{
   const {error}=await supabaseClient.auth.signInWithPassword({email,password});
   if(error) throw error;
  }
  $("#authDlg").close();
  $("#authForm").reset();
 }catch(error){console.error(error);authNotice(error.message||"Sign-in failed.")}
});
let targetEvent=null;
function openEnrollment(event){
 if(event.sample){toast("Run supabase.sql to enable enrollment for the sample events.");return}
 if(!session){openAuth("Sign in with a verified email before enrolling.");return}
 if(!session.user.email_confirmed_at){openAuth("Confirm your email before enrolling.");return}
 targetEvent=event;
 const isFree=Number(event.price)===0;
 const name=(session.user.user_metadata?.full_name||session.user.user_metadata?.name||"").trim().split(/\s+/);
 $("#purchaseTitle").textContent=isFree?"Enroll":"Buy tickets";
 $("#purchaseEvent").textContent=`${event.title} · ${fmt(event.date)} · ${event.venue}`;
 $("#purchaseUnitPrice").textContent=isFree?"Free enrollment":`Price per ticket: LKR ${Number(event.price).toLocaleString()}`;
 $("#buyerFirstName").value=name[0]||"";
 $("#buyerLastName").value=name.slice(1).join(" ");
 $("#payDetails").classList.toggle("hide",isFree);
 $("#payDetails").querySelectorAll("input").forEach(input=>input.required=!isFree);
 $("#ticketQuantity").value="1";
 $("#purchaseMessage").textContent="";
 updatePurchaseTotal();
 $("#purchaseDlg").showModal();
}
document.addEventListener("click",e=>{
 const button=e.target.closest("[data-reg]");
 if(!button)return;
 targetEvent=events.find(event=>event.id===button.dataset.reg);
 if(targetEvent) openEnrollment(targetEvent);
});

function updatePurchaseTotal(){
 if(!targetEvent)return;
 const quantity=Number($("#ticketQuantity").value)||0;
 const amount=quantity*Number(targetEvent.price);
 $("#purchaseTotal").textContent=amount?`Total: LKR ${amount.toLocaleString("en-LK",{minimumFractionDigits:2,maximumFractionDigits:2})}`:"Total: Free";
}
$("#ticketQuantity").addEventListener("input",updatePurchaseTotal);
$("#purchaseForm").addEventListener("submit",async e=>{
 e.preventDefault();
 if(!targetEvent||!session)return;
 const quantity=Number($("#ticketQuantity").value);
 if(!Number.isInteger(quantity)||quantity<1||quantity>5){$("#purchaseMessage").textContent="Choose between 1 and 5 tickets.";return}
 const buyer={
  firstName:$("#buyerFirstName").value.trim(),
  lastName:$("#buyerLastName").value.trim(),
  phone:$("#buyerPhone").value.trim(),
  IndexNumber:$("#buyerAddress").value.trim(),
  Department:$("#buyerCity").value.trim(),
  Faculty:$("#buyerFaculty").value.trim()
 };
 const isFree=Number(targetEvent.price)===0;
 const submit=$("#purchaseSubmit");
 submit.disabled=true;
 $("#purchaseMessage").textContent=isFree?"Issuing your tickets...":"Preparing secure sandbox checkout...";
 try{
  if(isFree){
   const result=await call("enroll","POST",{eventId:targetEvent.id,quantity,...buyer});
   tickets=Array.isArray(result.tickets)?result.tickets:tickets;
   $("#purchaseDlg").close();
   renderTickets();
   $("#ticketDlg").showModal();
  }else{
   const checkout=await call("payments/checkout","POST",{eventId:targetEvent.id,quantity,...buyer});
   const form=document.createElement("form");
   form.method="post";
   form.action=checkout.url;
   Object.entries(checkout.fields).forEach(([name,value])=>{
    const input=document.createElement("input");
    input.type="hidden";input.name=name;input.value=String(value);
    form.append(input);
   });
   document.body.append(form);
   form.submit();
  }
 }catch(error){
  console.error(error);
  $("#purchaseMessage").textContent=error.message||"Could not start enrollment.";
  submit.disabled=false;
 }
});

function renderTickets(){
 $("#ticketList").innerHTML=tickets.length?tickets.map(ticket=>`<article class="ticket-item">
  <strong>${esc(ticket.eventTitle)}</strong>
  <p>${fmt(ticket.eventDate)} · Holder: ${esc(ticket.buyerName)}</p>
  <p class="ticket-code">${esc(ticket.code)}</p>
 </article>`).join(""):`<p class="empty">No tickets yet. Enroll in a free event or complete a ticket purchase.</p>`;
}
$("#ticketNav").onclick=async()=>{
 await loadMyTickets();
 $("#ticketDlg").showModal();
};

async function handlePaymentReturn(){
 const params=new URLSearchParams(location.search);
 const result=params.get("payment");
 const orderId=params.get("order_id");
 if(!result)return;
 history.replaceState(null,"",location.pathname+location.hash);
 if(result==="cancelled"){toast("Payment was cancelled. No tickets were issued.");return}
 if(!session){openAuth("Sign in with the purchasing email to check your ticket status.");return}
 if(orderId){
  for(let attempt=0;attempt<5;attempt++){
   try{
    const order=await call(`orders/${encodeURIComponent(orderId)}`);
    if(order.status==="paid"){
     await loadMyTickets();
     $("#ticketDlg").showModal();
     return;
    }
   }catch(error){console.error(error);break}
   await new Promise(resolve=>setTimeout(resolve,1500));
  }
 }
 toast("Payment is being confirmed. Check My tickets shortly.");
 await loadMyTickets();
}

// ---------- add event ----------
$("#addBtn").onclick=()=>{
 if(!session){openAuth("Sign in before creating an event.");return}
 $("#ad").value=iso(1);$("#addDlg").showModal();
};
$("#addOk").onclick=async()=>{
 const title=$("#at").value.trim();
 const organizer=$("#organizer").value.trim();
 const venue=$("#av").value.trim();
 if(!title||!organizer||!venue||!$("#ad").value){toast("Add an event title, organizer, venue, and date.");return}
 const price=Number($("#ap").value);
 if(!Number.isFinite(price)||price<0){toast("Enter a valid non-negative price.");return}
 const ev={title,organizer,venue,date:$("#ad").value,price};
 const id="u"+Date.now().toString(36);
 try{
  const saved=await save("events",id,ev);
  events=events.concat(saved);
  $("#addDlg").close();$("#addForm").reset();render();toast("Event published");
 }catch(e){console.error(e);toast(e.message||"Event could not be saved.");}
};

async function initAuth(){
 try{
  const response=await fetch("/api/config");
  const config=await response.json();
  if(!response.ok) throw new Error(config.error||"Supabase Auth configuration is missing.");
  if(!window.supabase?.createClient) throw new Error("Supabase's browser library could not be loaded.");
  supabaseClient=window.supabase.createClient(config.url,config.anonKey);
  const {data,error}=await supabaseClient.auth.getSession();
  if(error) throw error;
  session=data.session;
  renderAuth();render();
  if(session){await loadMyTickets();await handlePaymentReturn()}
  supabaseClient.auth.onAuthStateChange((_event,nextSession)=>{
   session=nextSession;renderAuth();render();
   tickets=[];renderTickets();
   if(session){loadMyTickets();handlePaymentReturn()}
   if(session&&$("#authDlg").open) $("#authDlg").close();
  });
 }catch(error){
  console.error(error);
  authNotice("Could not initialize Supabase Auth. Check SUPABASE_URL and SUPABASE_ANON_KEY.");
 }
}

route();render();load();initAuth();
