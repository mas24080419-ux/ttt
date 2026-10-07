/* BusCheck Parent Dashboard
   Live map + pickup ETA + trip status, backed by the dedicated BusCheck Supabase project.
*/
(function(){
  "use strict";

  var state={
    client:null,session:null,selected:null,profile:null,trip:null,
    remote:null,map:null,busMarker:null,pickupMarker:null,routeLayer:null,
    statusChannel:null,lastRouteAt:0,lastRouteOrigin:null
  };

  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){
      return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }

  function addStyles(){
    if(document.getElementById("buscheckParentStyles")) return;
    var st=document.createElement("style");
    st.id="buscheckParentStyles";
    st.textContent=`
      #view-parent .parentWrap{max-width:none}
      .parentHeroGrid{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(360px,.85fr);gap:14px;margin-bottom:14px}
      .parentChildHero{min-height:124px}
      .parentQuickStats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
      .parentStat{padding:16px}.parentStat span,.parentStat small{display:block}.parentStat span{font-size:12px;color:var(--muted);font-weight:800}.parentStat strong{display:block;font-size:22px;margin:6px 0}.parentStat small{font-size:11px;color:var(--muted)}
      .parentMapCard{padding:16px;margin-bottom:14px}#parentBusMap{height:390px;border-radius:16px;overflow:hidden;border:1px solid var(--line);background:#e8edf4}
      .parentMapFoot{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:10px;color:var(--muted);font-size:12px}
      .parentPickupForm{display:grid;gap:10px}.parentPickupForm .search{min-width:0;width:100%}.parentPickupActions{display:flex;gap:8px}.parentPickupActions .btn{flex:1}
      .parentFormMsg{font-size:12px;color:var(--muted)}.parentFormMsg.ok{color:var(--success)}.parentFormMsg.error{color:var(--danger)}
      .parentOnlinePulse{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:currentColor}
      @media(max-width:1080px){.parentHeroGrid{grid-template-columns:1fr}.parentQuickStats{grid-template-columns:repeat(3,1fr)}}
      @media(max-width:760px){.parentQuickStats{grid-template-columns:1fr 1fr}.parentQuickStats .parentStat:first-child{grid-column:1/-1}#parentBusMap{height:330px}.parentPickupActions{flex-direction:column}}
    `;
    document.head.appendChild(st);
  }

  function setText(id,text){
    var el=document.getElementById(id); if(el) el.textContent=text;
  }
  function setBadge(id,text,kind){
    var el=document.getElementById(id); if(!el) return;
    el.textContent=text; el.className="badge "+(kind||"info");
  }
  function setFormMsg(text,kind){
    var el=document.getElementById("parentFormMsg"); if(!el) return;
    el.textContent=text; el.className="parentFormMsg"+(kind?" "+kind:"");
  }

  function ensureLeaflet(){
    if(window.L) return Promise.resolve(window.L);
    return new Promise(function(resolve,reject){
      var existing=document.querySelector('script[src*="leaflet"]');
      if(existing){
        existing.addEventListener("load",function(){window.L?resolve(window.L):reject(new Error("leaflet_missing"))},{once:true});
        existing.addEventListener("error",function(){reject(new Error("leaflet_failed"))},{once:true});
        setTimeout(function(){if(window.L) resolve(window.L)},1200);
        return;
      }
      var css=document.createElement("link");
      css.rel="stylesheet";css.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      css.integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";css.crossOrigin="";
      document.head.appendChild(css);
      var s=document.createElement("script");
      s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      s.integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";s.crossOrigin="";
      s.onload=function(){resolve(window.L)};s.onerror=function(){reject(new Error("leaflet_failed"))};
      document.head.appendChild(s);
    });
  }

  function initMap(){
    if(state.map || !window.L || !document.getElementById("parentBusMap")) return;
    state.map=window.L.map("parentBusMap",{zoomControl:true}).setView([15.9,107.8],5);
    window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,attribution:"&copy; OpenStreetMap contributors"
    }).addTo(state.map);
    setTimeout(function(){state.map.invalidateSize()},100);
  }

  function showMapWhenParentView(){
    setTimeout(function(){
      if(state.map) state.map.invalidateSize();
      fitMap();
    },120);
  }

  function fmtTime(ts){
    if(!ts) return "—";
    try{return new Date(ts).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch(e){return "—"}
  }

  function ageSeconds(ts){
    if(!ts) return Infinity;
    var t=new Date(ts).getTime();
    return isFinite(t)?Math.max(0,Math.round((Date.now()-t)/1000)):Infinity;
  }

  function initials(name){
    var p=String(name||"HS").trim().split(/\s+/).filter(Boolean);
    if(!p.length) return "HS";
    return (p.length===1?p[0].slice(0,2):p[0][0]+p[p.length-1][0]).toUpperCase();
  }

  function roleIsParent(){
    return state.selected && state.selected.access_role==="parent";
  }

  function updateVehicleHeader(){
    if(!state.selected){
      setText("parentVehicleName","—");setText("parentRouteName","Chưa ghép xe");
      return;
    }
    setText("parentVehicleName",state.selected.vehicle.label||state.selected.vehicle.code||"Xe");
    setText("parentRouteName",state.selected.vehicle.route_name||state.selected.vehicle.code||"");
  }

  function updateTripUI(){
    var child=(state.profile&&state.profile.child_name)||(state.trip&&state.trip.child_name)||"Chưa cấu hình học sinh";
    setText("parentChildName",child);
    setText("parentChildAvatar",initials(child));

    var status=state.trip&&state.trip.status;
    var title="Chưa ghi nhận lên xe",badge="Chưa ghi nhận",kind="warning",meta="Hệ thống đang chờ dữ liệu quét của chuyến hôm nay.";
    if(status==="waiting"){title="Chưa lên xe";badge="Chưa lên";kind="warning";meta="Chưa có lượt quét lên xe được xác nhận."}
    if(status==="boarded"){title="Đã lên xe an toàn";badge="Đã lên xe";kind="success";meta="Ghi nhận lúc "+fmtTime(state.trip.event_at||state.trip.updated_at)}
    if(status==="alighted"){title="Đã xuống xe";badge="Đã xuống";kind="success";meta="Ghi nhận lúc "+fmtTime(state.trip.event_at||state.trip.updated_at)}
    if(status==="absent"){title="Vắng mặt hôm nay";badge="Vắng";kind="danger";meta="Trạng thái chuyến hôm nay đã được đánh dấu vắng."}
    setText("parentTripState",title);setText("parentTripMeta",meta);setBadge("parentTripBadge",badge,kind);

    var tl=document.getElementById("parentTimeline");
    if(tl){
      if(!state.trip){
        tl.innerHTML='<div><i></i><span><b>Chưa có sự kiện</b> Hệ thống đang chờ dữ liệu quét lên/xuống xe.</span></div>';
      }else{
        var label={waiting:"Chưa lên xe",boarded:"Đã lên xe",alighted:"Đã xuống xe",absent:"Vắng mặt"}[status]||status;
        var done=(status==="boarded"||status==="alighted")?"done":"";
        tl.innerHTML='<div class="'+done+'"><i></i><span><b>'+esc(fmtTime(state.trip.event_at||state.trip.updated_at))+'</b> '+esc(label)+'</span></div>';
      }
    }
  }

  function updateRemoteUI(){
    if(!state.remote){
      setBadge("parentGpsState","Chưa có GPS","info");
      setText("parentLastUpdate","Chưa có vị trí xe");
      setText("parentEtaNote","Chờ GPS xe");
      return;
    }
    var age=ageSeconds(state.remote.recorded_at||state.remote.updated_at);
    if(age<=45) setBadge("parentGpsState","Xe đang trực tuyến","success");
    else setBadge("parentGpsState","GPS đã cũ","warning");
    setText("parentLastUpdate","GPS cập nhật "+fmtTime(state.remote.recorded_at||state.remote.updated_at)+(age<Infinity?" · "+age+" giây trước":""));
    setText("parentMapSubtitle",state.selected?(state.selected.vehicle.label+" · "+(state.selected.vehicle.route_name||state.selected.vehicle.code)):"Vị trí xe realtime");

    if(state.map){
      var ll=[Number(state.remote.lat),Number(state.remote.lon)];
      if(!state.busMarker){
        state.busMarker=window.L.circleMarker(ll,{radius:10,weight:3,fillOpacity:.78}).addTo(state.map);
      }else state.busMarker.setLatLng(ll);
      state.busMarker.bindPopup("<b>"+esc(state.selected?state.selected.vehicle.label:"Xe BusCheck")+"</b><br>GPS "+esc(fmtTime(state.remote.recorded_at||state.remote.updated_at)));
    }
    fitMap();
  }

  function updatePickupUI(){
    var has=state.profile&&isFinite(state.profile.pickup_lat)&&isFinite(state.profile.pickup_lon);
    var label=has?(state.profile.pickup_name||"Điểm đón đã lưu"):"chưa thiết lập";
    setText("parentPickupLabel","Điểm đón: "+label);
    if(state.profile){
      var child=document.getElementById("parentChildInput");
      var pickup=document.getElementById("parentPickupInput");
      if(child && !child.matches(":focus")) child.value=state.profile.child_name||"";
      if(pickup && !pickup.matches(":focus")) pickup.value=state.profile.pickup_name||"";
    }
    if(state.map){
      if(has){
        var ll=[Number(state.profile.pickup_lat),Number(state.profile.pickup_lon)];
        if(!state.pickupMarker){
          state.pickupMarker=window.L.marker(ll).addTo(state.map).bindPopup("<b>Điểm đón</b>");
        }else state.pickupMarker.setLatLng(ll);
        state.pickupMarker.bindPopup("<b>Điểm đón</b><br>"+esc(label));
      }else if(state.pickupMarker){
        state.map.removeLayer(state.pickupMarker);state.pickupMarker=null;
      }
    }
    fitMap();
  }

  function fitMap(){
    if(!state.map) return;
    var pts=[];
    if(state.remote&&isFinite(state.remote.lat)&&isFinite(state.remote.lon)) pts.push([Number(state.remote.lat),Number(state.remote.lon)]);
    if(state.profile&&isFinite(state.profile.pickup_lat)&&isFinite(state.profile.pickup_lon)) pts.push([Number(state.profile.pickup_lat),Number(state.profile.pickup_lon)]);
    if(pts.length===1) state.map.setView(pts[0],16);
    else if(pts.length>1) state.map.fitBounds(pts,{padding:[30,30],maxZoom:16});
  }

  async function geocode(text){
    var q=String(text||"").trim();
    var m=q.match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
    if(m){
      var lat=Number(m[1]),lon=Number(m[2]);
      if(lat>=-90&&lat<=90&&lon>=-180&&lon<=180) return {lat:lat,lon:lon,label:q};
    }
    if(!q) throw new Error("empty");
    var url="https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&accept-language=vi&q="+encodeURIComponent(q);
    var res=await fetch(url,{headers:{"Accept":"application/json"}});
    if(!res.ok) throw new Error("http");
    var data=await res.json();
    if(!Array.isArray(data)||!data.length) throw new Error("not_found");
    return {lat:Number(data[0].lat),lon:Number(data[0].lon),label:data[0].display_name||q};
  }

  function routeMovedEnough(){
    if(!state.remote) return false;
    if(!state.lastRouteOrigin) return true;
    var dx=Number(state.remote.lat)-state.lastRouteOrigin.lat;
    var dy=Number(state.remote.lon)-state.lastRouteOrigin.lon;
    return Math.sqrt(dx*dx+dy*dy)>0.0008;
  }

  async function refreshEta(force){
    var hasPickup=state.profile&&isFinite(state.profile.pickup_lat)&&isFinite(state.profile.pickup_lon);
    if(!state.remote||!hasPickup){
      setText("parentDistance","—");setText("parentEta","—");
      setText("parentEtaNote",!hasPickup?"Chưa có điểm đón":"Chờ GPS xe");
      if(state.routeLayer&&state.map){state.map.removeLayer(state.routeLayer);state.routeLayer=null}
      return;
    }
    var now=Date.now();
    if(!force && now-state.lastRouteAt<15000 && !routeMovedEnough()) return;
    state.lastRouteAt=now;
    state.lastRouteOrigin={lat:Number(state.remote.lat),lon:Number(state.remote.lon)};
    setText("parentEtaNote","Đang tính theo tuyến đường...");
    try{
      var url="https://router.project-osrm.org/route/v1/driving/"+
        encodeURIComponent(state.remote.lon)+","+encodeURIComponent(state.remote.lat)+";"+
        encodeURIComponent(state.profile.pickup_lon)+","+encodeURIComponent(state.profile.pickup_lat)+
        "?overview=full&geometries=geojson";
      var res=await fetch(url);
      if(!res.ok) throw new Error("http");
      var data=await res.json();
      if(data.code!=="Ok"||!data.routes||!data.routes.length) throw new Error("route");
      var r=data.routes[0],km=r.distance/1000,mins=Math.max(1,Math.round(r.duration/60));
      setText("parentDistance",km.toFixed(1)+" km");
      setText("parentEta",mins+" phút");
      setText("parentEtaNote","ETA cơ sở · chưa tính tắc đường realtime");
      if(state.map){
        if(state.routeLayer) state.map.removeLayer(state.routeLayer);
        state.routeLayer=window.L.geoJSON(r.geometry,{style:{weight:5,opacity:.72}}).addTo(state.map);
        fitMap();
      }
    }catch(e){
      setText("parentDistance","—");setText("parentEta","—");setText("parentEtaNote","Chưa tính được tuyến");
    }
  }

  async function ensureProfile(){
    if(!state.client||!state.session||!state.selected||!roleIsParent()) return;
    var r=await state.client.from("bus_parent_profiles").select("*").eq("user_id",state.session.user.id).maybeSingle();
    if(r.error){setFormMsg("Không tải được hồ sơ phụ huynh.","error");return}
    if(!r.data){
      var up=await state.client.from("bus_parent_profiles").upsert({
        user_id:state.session.user.id,vehicle_id:state.selected.vehicle_id,updated_at:new Date().toISOString()
      },{onConflict:"user_id"}).select("*").single();
      if(up.error){setFormMsg("Chưa tạo được hồ sơ điểm đón.","error");return}
      state.profile=up.data;
    }else{
      state.profile=r.data;
      if(state.profile.vehicle_id!==state.selected.vehicle_id){
        var ch=await state.client.from("bus_parent_profiles").update({
          vehicle_id:state.selected.vehicle_id,updated_at:new Date().toISOString()
        }).eq("user_id",state.session.user.id).select("*").single();
        if(!ch.error) state.profile=ch.data;
      }
    }
    updatePickupUI();updateTripUI();await loadTripStatus();await refreshEta(true);
  }

  async function loadTripStatus(){
    if(!state.client||!state.session||!state.selected||!roleIsParent()) return;
    var today=new Date().toLocaleDateString("en-CA");
    var r=await state.client.from("bus_parent_trip_status").select("*")
      .eq("user_id",state.session.user.id).eq("vehicle_id",state.selected.vehicle_id)
      .eq("service_date",today).maybeSingle();
    if(!r.error) state.trip=r.data||null;
    updateTripUI();
    await subscribeTripStatus();
  }

  async function subscribeTripStatus(){
    if(!state.client||!state.session) return;
    if(state.statusChannel){await state.client.removeChannel(state.statusChannel);state.statusChannel=null}
    state.statusChannel=state.client.channel("parent-trip-"+state.session.user.id)
      .on("postgres_changes",{
        event:"*",schema:"public",table:"bus_parent_trip_status",
        filter:"user_id=eq."+state.session.user.id
      },function(payload){
        var row=payload.new||null;
        if(row && state.selected && row.vehicle_id===state.selected.vehicle_id){
          state.trip=row;updateTripUI();
        }
      }).subscribe();
  }

  async function savePickup(){
    if(!state.client||!state.session||!state.selected||!roleIsParent()){
      setFormMsg("Cần đăng nhập bằng quyền phụ huynh trước.","error");return;
    }
    var name=document.getElementById("parentChildInput").value.trim();
    var pickup=document.getElementById("parentPickupInput").value.trim();
    if(!name){setFormMsg("Nhập tên học sinh.","error");return}
    if(!pickup){setFormMsg("Nhập địa chỉ điểm đón.","error");return}
    setFormMsg("Đang xác định điểm đón...");
    try{
      var geo=await geocode(pickup);
      var r=await state.client.from("bus_parent_profiles").upsert({
        user_id:state.session.user.id,vehicle_id:state.selected.vehicle_id,
        child_name:name,pickup_name:geo.label,pickup_lat:geo.lat,pickup_lon:geo.lon,
        updated_at:new Date().toISOString()
      },{onConflict:"user_id"}).select("*").single();
      if(r.error) throw r.error;
      state.profile=r.data;setFormMsg("Đã lưu điểm đón.","ok");
      updatePickupUI();updateTripUI();await refreshEta(true);
    }catch(e){setFormMsg("Không tìm thấy điểm đón hoặc không thể lưu dữ liệu.","error")}
  }

  function useMyLocation(){
    if(!navigator.geolocation){setFormMsg("Thiết bị không hỗ trợ GPS.","error");return}
    setFormMsg("Đang lấy vị trí hiện tại...");
    navigator.geolocation.getCurrentPosition(function(pos){
      var input=document.getElementById("parentPickupInput");
      if(input) input.value=pos.coords.latitude.toFixed(6)+", "+pos.coords.longitude.toFixed(6);
      setFormMsg("Đã lấy vị trí hiện tại. Bấm “Lưu điểm đón” để xác nhận.","ok");
    },function(){setFormMsg("Không lấy được vị trí hiện tại. Kiểm tra quyền Location.","error")},{
      enableHighAccuracy:true,timeout:12000,maximumAge:5000
    });
  }

  function handleReady(){
    if(!window.BusCheckRealtime) return;
    state.client=window.BusCheckRealtime.client;
    state.session=window.BusCheckRealtime.getSession?window.BusCheckRealtime.getSession():null;
    state.selected=window.BusCheckRealtime.getSelected?window.BusCheckRealtime.getSelected():null;
    updateVehicleHeader();
    if(state.selected&&roleIsParent()) ensureProfile();
  }

  function handleSelected(item){
    state.selected=item||null;state.remote=null;state.trip=null;
    updateVehicleHeader();updateRemoteUI();updateTripUI();
    if(state.selected&&roleIsParent()) ensureProfile();
    else if(state.selected){
      setText("parentTripMeta","Tài khoản đang chọn quyền tài xế. Chuyển sang xe có quyền phụ huynh để xem dashboard con.");
    }
  }

  function handleRemote(row,item){
    if(!state.selected||!item||item.vehicle_id!==state.selected.vehicle_id) return;
    state.remote=row;updateRemoteUI();refreshEta(false);
  }

  function bind(){
    var save=document.getElementById("parentSavePickup");
    var use=document.getElementById("parentUseMyLocation");
    var center=document.getElementById("parentCenterMap");
    if(save) save.addEventListener("click",savePickup);
    if(use) use.addEventListener("click",useMyLocation);
    if(center) center.addEventListener("click",function(){
      if(state.map&&state.remote) state.map.setView([Number(state.remote.lat),Number(state.remote.lon)],17);
    });
    document.querySelectorAll('[data-view="parent"]').forEach(function(b){b.addEventListener("click",showMapWhenParentView)});
    window.addEventListener("buscheck:realtime-ready",function(){handleReady()});
    window.addEventListener("buscheck:auth-state",function(e){
      state.session=e.detail&&e.detail.session||null;
      if(!state.session){state.profile=null;state.trip=null;state.remote=null;updateTripUI();updateRemoteUI()}
      else handleReady();
    });
    window.addEventListener("buscheck:vehicle-selected",function(e){handleSelected(e.detail&&e.detail.item)});
    window.addEventListener("buscheck:remote-location",function(e){handleRemote(e.detail&&e.detail.row,e.detail&&e.detail.item)});
  }

  async function bootstrap(){
    addStyles();bind();
    try{await ensureLeaflet();initMap()}catch(e){
      var m=document.getElementById("parentBusMap");if(m) m.innerHTML='<div style="padding:24px">Không tải được bản đồ.</div>';
    }
    handleReady();
    window.BusCheckParentDashboard={
      refreshEta:function(){return refreshEta(true)},
      reload:function(){return ensureProfile()}
    };
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",bootstrap);
  else bootstrap();
})();
