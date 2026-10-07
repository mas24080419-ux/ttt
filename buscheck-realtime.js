/* BusCheck Realtime — isolated Supabase project.
   Uses only a publishable key. Authorization is enforced by Postgres RLS.
   @supabase/supabase-js is pinned to 2.117.2.
*/
(function(){
  "use strict";

  var SUPABASE_URL="https://medsjppfuwmdxmvpclqs.supabase.co";
  var SUPABASE_KEY="sb_publishable_O-ePmnjsw0G5bgsPay1jDQ_MlUychkT";
  var client=null, session=null, accessList=[], selected=null, channel=null;
  var lastSentAt=0, sending=false;

  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }

  function loadSupabase(){
    if(window.supabase && window.supabase.createClient) return Promise.resolve(window.supabase);
    return new Promise(function(resolve,reject){
      var s=document.createElement("script");
      s.src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.min.js";
      s.crossOrigin="anonymous";
      s.onload=function(){resolve(window.supabase)};
      s.onerror=function(){reject(new Error("supabase_js_load_failed"))};
      document.head.appendChild(s);
    });
  }

  function addStyles(){
    if(document.getElementById("buscheckRealtimeStyles")) return;
    var style=document.createElement("style");
    style.id="buscheckRealtimeStyles";
    style.textContent=`
      .rtAuth{display:grid;gap:10px}.rtAuth input,.rtAuth select{
        width:100%;min-height:44px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:#fff;color:var(--text)
      }
      .rtAuthGrid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .rtRow{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.rtRow .btn{flex:1}
      .rtUser{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:10px 12px;border-radius:12px;background:var(--subtle)}
      .rtUser small{display:block;color:var(--muted)}
      .rtAccessList{display:grid;gap:8px;margin-top:8px}
      .rtAccess{display:flex;justify-content:space-between;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#fff}
      .rtAccess small{display:block;color:var(--muted)}
      .rtStatus{font-size:12px;color:var(--muted);line-height:1.45}
      .rtStatus.error{color:var(--danger)}.rtStatus.ok{color:var(--success)}
      .rtDivider{height:1px;background:var(--line);margin:2px 0}
      .parentRealtime{grid-column:1/-1}
      @media(max-width:760px){.rtAuthGrid{grid-template-columns:1fr}.parentRealtime{grid-column:auto}}
    `;
    document.head.appendChild(style);
  }

  function addUI(){
    var side=document.querySelector("#view-mobility .mobilitySide");
    if(side && !document.getElementById("realtimeCard")){
      var card=document.createElement("article");
      card.className="card panel";
      card.id="realtimeCard";
      card.innerHTML=`
        <div class="panelHead">
          <div><h3>Supabase Realtime</h3><p>Tài xế phát GPS · phụ huynh xem đúng xe được cấp quyền.</p></div>
          <span class="badge info" id="rtConnectionBadge">Chưa đăng nhập</span>
        </div>
        <div id="rtLoggedOut" class="rtAuth">
          <div class="rtAuthGrid">
            <input id="rtEmail" type="email" autocomplete="email" placeholder="Email">
            <input id="rtPassword" type="password" autocomplete="current-password" minlength="6" placeholder="Mật khẩu">
          </div>
          <div class="rtRow">
            <button class="btn primary" id="rtSignIn">Đăng nhập</button>
            <button class="btn secondary" id="rtSignUp">Tạo tài khoản</button>
          </div>
          <div class="rtStatus" id="rtAuthMsg">Đăng nhập bằng tài khoản BusCheck riêng.</div>
        </div>
        <div id="rtLoggedIn" class="rtAuth" hidden>
          <div class="rtUser"><div><b id="rtUserEmail">—</b><small>BusCheck account</small></div><button class="btn ghost" id="rtSignOut">Đăng xuất</button></div>
          <div class="rtDivider"></div>
          <label style="font-size:12px;font-weight:800;color:var(--muted)" for="rtAccessCode">Mã ghép xe</label>
          <div class="rtRow"><input id="rtAccessCode" autocomplete="off" placeholder="Nhập mã tài xế hoặc phụ huynh"><button class="btn secondary" id="rtClaim">Ghép xe</button></div>
          <div class="rtStatus" id="rtClaimMsg">Mã được băm SHA-256 trên thiết bị trước khi gửi lên server.</div>
          <div class="rtDivider"></div>
          <label style="font-size:12px;font-weight:800;color:var(--muted)" for="rtVehicle">Xe đang theo dõi</label>
          <select id="rtVehicle"><option value="">Chưa có xe được cấp quyền</option></select>
          <div id="rtRoleInfo" class="rtStatus">Nhập mã ghép xe để bắt đầu.</div>
          <div class="rtRow">
            <button class="btn primary" id="rtStartGps" disabled>Bắt đầu phát GPS</button>
            <button class="btn secondary" id="rtRefresh">Làm mới quyền</button>
          </div>
          <div class="rtAccessList" id="rtAccessList"></div>
        </div>
      `;
      side.insertBefore(card,side.firstChild);
    }

    var parentGrid=document.querySelector("#view-parent .parentGrid");
    if(parentGrid && !document.getElementById("parentRealtimeCard")){
      var pc=document.createElement("article");
      pc.className="card panel parentRealtime";
      pc.id="parentRealtimeCard";
      pc.innerHTML=`
        <div class="panelHead"><div><h3>Theo dõi xe Realtime</h3><p id="parentRealtimeText">Đăng nhập và ghép mã phụ huynh để nhận vị trí xe.</p></div><span class="badge info" id="parentRealtimeBadge">Offline</span></div>
        <button class="btn primary" id="parentOpenMap">Mở bản đồ xe</button>
      `;
      parentGrid.appendChild(pc);
    }
  }

  function setMsg(id,text,kind){
    var el=document.getElementById(id);
    if(!el) return;
    el.textContent=text;
    el.className="rtStatus"+(kind?" "+kind:"");
  }

  function setConnection(text,kind){
    var b=document.getElementById("rtConnectionBadge");
    if(b){b.textContent=text;b.className="badge "+(kind||"info")}
    var sync=document.getElementById("syncBadge");
    if(sync && session){sync.textContent=text;sync.className="badge "+(kind||"info")}
  }

  async function sha256(text){
    var bytes=new TextEncoder().encode(String(text||"").trim());
    var digest=await crypto.subtle.digest("SHA-256",bytes);
    return Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,"0")}).join("");
  }

  async function refreshSessionUI(){
    var loggedOut=document.getElementById("rtLoggedOut"), loggedIn=document.getElementById("rtLoggedIn");
    if(!session){
      loggedOut.hidden=false;loggedIn.hidden=true;
      setConnection("Chưa đăng nhập","info");
      selected=null;accessList=[];
      if(channel && client){await client.removeChannel(channel);channel=null}
      updateParentStatus(null);
      window.dispatchEvent(new CustomEvent("buscheck:auth-state",{detail:{session:null}}));
      return;
    }
    loggedOut.hidden=true;loggedIn.hidden=false;
    document.getElementById("rtUserEmail").textContent=session.user.email||"BusCheck user";
    setConnection("Đã đăng nhập","success");
    window.dispatchEvent(new CustomEvent("buscheck:auth-state",{detail:{session:session}}));
    await loadAccess();
  }

  async function signIn(){
    var email=document.getElementById("rtEmail").value.trim();
    var password=document.getElementById("rtPassword").value;
    if(!email||!password){setMsg("rtAuthMsg","Nhập email và mật khẩu.","error");return}
    setMsg("rtAuthMsg","Đang đăng nhập...");
    var r=await client.auth.signInWithPassword({email:email,password:password});
    if(r.error){setMsg("rtAuthMsg",r.error.message,"error");return}
    session=r.data.session;
    setMsg("rtAuthMsg","Đăng nhập thành công.","ok");
    await refreshSessionUI();
  }

  async function signUp(){
    var email=document.getElementById("rtEmail").value.trim();
    var password=document.getElementById("rtPassword").value;
    if(!email||password.length<6){setMsg("rtAuthMsg","Nhập email và mật khẩu ít nhất 6 ký tự.","error");return}
    setMsg("rtAuthMsg","Đang tạo tài khoản...");
    var r=await client.auth.signUp({email:email,password:password});
    if(r.error){setMsg("rtAuthMsg",r.error.message,"error");return}
    session=r.data.session||null;
    if(session){
      setMsg("rtAuthMsg","Tạo tài khoản thành công.","ok");
      await refreshSessionUI();
    }else{
      setMsg("rtAuthMsg","Đã tạo tài khoản. Hãy kiểm tra email để xác nhận rồi đăng nhập.","ok");
    }
  }

  async function signOut(){
    await client.auth.signOut();
    session=null;
    await refreshSessionUI();
  }

  async function claimAccess(){
    if(!session){setMsg("rtClaimMsg","Bạn cần đăng nhập trước.","error");return}
    var raw=document.getElementById("rtAccessCode").value.trim();
    if(!raw){setMsg("rtClaimMsg","Nhập mã ghép xe.","error");return}
    setMsg("rtClaimMsg","Đang xác minh mã...");
    try{
      var hash=await sha256(raw);
      var r=await client.from("bus_access_claims").insert({user_id:session.user.id,code_hash:hash}).select("vehicle_id,access_role").single();
      if(r.error) throw r.error;
      document.getElementById("rtAccessCode").value="";
      setMsg("rtClaimMsg","Ghép xe thành công: quyền "+(r.data.access_role==="driver"?"tài xế":"phụ huynh")+".","ok");
      await loadAccess(r.data.vehicle_id);
    }catch(e){
      setMsg("rtClaimMsg","Mã không hợp lệ, đã hết lượt hoặc tài khoản chưa được xác nhận.","error");
    }
  }

  async function loadAccess(preferredId){
    if(!session) return;
    var a=await client.from("bus_vehicle_access").select("vehicle_id,access_role,active").eq("active",true);
    if(a.error){setMsg("rtRoleInfo","Không tải được quyền xe: "+a.error.message,"error");return}
    if(!a.data.length){
      accessList=[];selected=null;renderAccess();
      setMsg("rtRoleInfo","Tài khoản chưa được ghép với xe nào.");
      updateParentStatus(null);
      return;
    }
    var ids=a.data.map(function(x){return x.vehicle_id});
    var v=await client.from("bus_vehicles").select("id,code,label,route_name,active").in("id",ids);
    if(v.error){setMsg("rtRoleInfo","Không tải được danh sách xe.","error");return}
    accessList=a.data.map(function(x){
      var vehicle=v.data.find(function(y){return y.id===x.vehicle_id})||{id:x.vehicle_id,code:"BUS",label:"Xe"};
      return {vehicle_id:x.vehicle_id,access_role:x.access_role,vehicle:vehicle};
    });
    renderAccess();

    var wanted=preferredId||localStorage.getItem("buscheck:selected-vehicle");
    var item=accessList.find(function(x){return x.vehicle_id===wanted})||accessList[0];
    document.getElementById("rtVehicle").value=item.vehicle_id;
    await chooseVehicle(item.vehicle_id);
  }

  function renderAccess(){
    var select=document.getElementById("rtVehicle"), list=document.getElementById("rtAccessList");
    if(!select||!list) return;
    if(!accessList.length){
      select.innerHTML='<option value="">Chưa có xe được cấp quyền</option>';list.innerHTML="";return;
    }
    select.innerHTML=accessList.map(function(x){
      return '<option value="'+esc(x.vehicle_id)+'">'+esc(x.vehicle.label)+" · "+esc(x.vehicle.route_name||x.vehicle.code)+" · "+(x.access_role==="driver"?"Tài xế":"Phụ huynh")+'</option>';
    }).join("");
    list.innerHTML=accessList.map(function(x){
      return '<div class="rtAccess"><div><b>'+esc(x.vehicle.label)+'</b><small>'+esc(x.vehicle.route_name||x.vehicle.code)+'</small></div><span class="badge '+(x.access_role==="driver"?"info":"success")+'">'+(x.access_role==="driver"?"Tài xế":"Phụ huynh")+'</span></div>';
    }).join("");
  }

  async function chooseVehicle(id){
    if(!id){selected=null;return}
    selected=accessList.find(function(x){return x.vehicle_id===id})||null;
    if(!selected) return;
    localStorage.setItem("buscheck:selected-vehicle",id);

    var driver=selected.access_role==="driver"||selected.access_role==="admin";
    var start=document.getElementById("rtStartGps");
    start.disabled=!driver;
    start.textContent=driver?"Bắt đầu phát GPS":"Chỉ tài xế được phát GPS";
    setMsg("rtRoleInfo",driver
      ? "Bạn đang ở quyền tài xế. Khi GPS chạy, vị trí sẽ gửi lên Supabase tối đa mỗi 5 giây."
      : "Bạn đang ở quyền phụ huynh. Vị trí xe sẽ tự cập nhật qua Supabase Realtime."
    );
    updateParentStatus(selected);
    window.dispatchEvent(new CustomEvent("buscheck:vehicle-selected",{detail:{item:selected}}));
    await subscribeVehicle(selected);
  }

  async function subscribeVehicle(item){
    if(channel){await client.removeChannel(channel);channel=null}
    var current=await client.from("bus_vehicle_locations")
      .select("vehicle_id,lat,lon,accuracy_m,speed_mps,heading_deg,recorded_at,updated_at")
      .eq("vehicle_id",item.vehicle_id).maybeSingle();
    if(!current.error && current.data) showRemote(current.data,item);

    channel=client.channel("bus-location-"+item.vehicle_id)
      .on("postgres_changes",{
        event:"*",schema:"public",table:"bus_vehicle_locations",
        filter:"vehicle_id=eq."+item.vehicle_id
      },function(payload){
        var row=payload.new||payload.old;
        if(row) showRemote(row,item);
      })
      .subscribe(function(status){
        if(status==="SUBSCRIBED"){
          setConnection("Realtime đã kết nối","success");
        }else if(status==="CHANNEL_ERROR"||status==="TIMED_OUT"){
          setConnection("Realtime mất kết nối","danger");
        }
      });
  }

  function showRemote(row,item){
    window.dispatchEvent(new CustomEvent("buscheck:remote-location",{detail:{row:row,item:item}}));
    if(window.BusCheckMobility && window.BusCheckMobility.showRemoteVehicleLocation){
      window.BusCheckMobility.showRemoteVehicleLocation(row,item.vehicle.label);
    }
    var badge=document.getElementById("parentRealtimeBadge");
    var text=document.getElementById("parentRealtimeText");
    if(badge){badge.className="badge success";badge.textContent="Đang trực tuyến"}
    if(text){
      var t=new Date(row.recorded_at||row.updated_at).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit"});
      text.textContent=item.vehicle.label+" · "+(item.vehicle.route_name||item.vehicle.code)+" · cập nhật "+t;
    }
  }

  function updateParentStatus(item){
    var badge=document.getElementById("parentRealtimeBadge"),text=document.getElementById("parentRealtimeText");
    if(!badge||!text) return;
    if(!session){badge.className="badge info";badge.textContent="Offline";text.textContent="Đăng nhập và ghép mã phụ huynh để nhận vị trí xe.";return}
    if(!item){badge.className="badge warning";badge.textContent="Chưa ghép xe";text.textContent="Nhập mã ghép xe trong mục Bản đồ & GPS.";return}
    badge.className="badge info";badge.textContent="Đang kết nối";
    text.textContent=item.vehicle.label+" · "+(item.access_role==="driver"?"quyền tài xế":"quyền phụ huynh");
  }

  async function persistGps(payload){
    if(!client||!session||!selected) return;
    if(selected.access_role!=="driver"&&selected.access_role!=="admin") return;
    if(!payload||!isFinite(payload.lat)||!isFinite(payload.lon)) return;
    var ts=Number(payload.timestamp||0);
    if(!ts || Math.abs(Date.now()-ts)>30000) return;
    var now=Date.now();
    if(sending || now-lastSentAt<5000) return;
    sending=true;lastSentAt=now;
    try{
      var row={
        vehicle_id:selected.vehicle_id,
        lat:Number(payload.lat),lon:Number(payload.lon),
        accuracy_m:payload.accuracy==null?null:Number(payload.accuracy),
        speed_mps:payload.speed==null?null:Number(payload.speed),
        heading_deg:payload.heading==null?null:Number(payload.heading),
        recorded_at:new Date(ts).toISOString(),
        updated_by:session.user.id,
        updated_at:new Date().toISOString()
      };
      var r=await client.from("bus_vehicle_locations").upsert(row,{onConflict:"vehicle_id"});
      if(r.error) throw r.error;
      setConnection("GPS đã đồng bộ","success");
    }catch(e){
      setConnection("Lỗi gửi GPS","danger");
      console.error("BusCheck GPS sync:",e);
    }finally{sending=false}
  }

  function bind(){
    document.getElementById("rtSignIn").addEventListener("click",signIn);
    document.getElementById("rtSignUp").addEventListener("click",signUp);
    document.getElementById("rtSignOut").addEventListener("click",signOut);
    document.getElementById("rtClaim").addEventListener("click",claimAccess);
    document.getElementById("rtRefresh").addEventListener("click",function(){loadAccess()});
    document.getElementById("rtVehicle").addEventListener("change",function(e){chooseVehicle(e.target.value)});
    document.getElementById("rtStartGps").addEventListener("click",function(){
      if(selected&&(selected.access_role==="driver"||selected.access_role==="admin")&&window.BusCheckMobility){
        window.BusCheckMobility.startGps();
      }
    });
    document.getElementById("rtAccessCode").addEventListener("keydown",function(e){if(e.key==="Enter") claimAccess()});
    document.getElementById("parentOpenMap").addEventListener("click",function(){
      if(typeof window.showView==="function") window.showView("mobility");
      setTimeout(function(){window.scrollTo({top:0,behavior:"smooth"})},50);
    });
    window.addEventListener("buscheck:gps",function(e){persistGps(e.detail)});
  }

  async function bootstrap(){
    addStyles();addUI();bind();
    try{
      var lib=await loadSupabase();
      client=lib.createClient(SUPABASE_URL,SUPABASE_KEY,{
        auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
      });
      var s=await client.auth.getSession();
      session=s.data.session||null;
      client.auth.onAuthStateChange(function(event,newSession){
        session=newSession||null;
        setTimeout(function(){refreshSessionUI()},0);
      });
      await refreshSessionUI();
      window.BusCheckRealtime={
        client:client,
        refreshAccess:loadAccess,
        getSelected:function(){return selected},
        getSession:function(){return session},
        getAccessList:function(){return accessList.slice()}
      };
      window.dispatchEvent(new CustomEvent("buscheck:realtime-ready",{detail:{session:session}}));
    }catch(e){
      setConnection("Không tải được Supabase","danger");
      setMsg("rtAuthMsg","Không thể tải kết nối Supabase. Kiểm tra mạng rồi tải lại trang.","error");
    }
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",bootstrap);
  else bootstrap();
})();
