/* BusCheck Mobility — GPS, map, geocoding, routing and weather.
   No secrets are embedded. GPS is real browser geolocation.
   External data: OpenStreetMap/Nominatim, OSRM, Open-Meteo.
*/
(function(){
  "use strict";

  var state = {
    map:null, L:null, gpsMarker:null, accuracyCircle:null, remoteMarker:null, remoteAccuracy:null, remoteLatest:null, routeLayer:null,
    watchId:null, latestGps:null, lastWeatherAt:0, destination:null, origin:null
  };

  function addStyles(){
    if(document.getElementById("buscheckMobilityStyles")) return;
    var style=document.createElement("style");
    style.id="buscheckMobilityStyles";
    style.textContent=`
      .mobilityGrid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(320px,.55fr);gap:14px}
      .mobilityMapCard{padding:14px}.mobilitySide{display:grid;gap:14px;align-content:start}
      #busMap{height:500px;border-radius:16px;overflow:hidden;background:#e8edf4;border:1px solid var(--line)}
      .mobilityToolbar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
      .mobilityToolbar .btn{min-height:42px}
      .mobilityStatus{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:0 0 12px}
      .mobilityStatus small{color:var(--muted)}
      .routeForm{display:grid;gap:10px}.routeForm label{font-size:12px;font-weight:800;color:var(--muted)}
      .routeForm input{width:100%;min-height:44px;border:1px solid var(--line);border-radius:12px;padding:0 12px;background:#fff}
      .routeActions{display:flex;gap:8px;flex-wrap:wrap}.routeActions .btn{flex:1}
      .routeResult{margin-top:12px;padding-top:12px;border-top:1px solid var(--line);display:grid;gap:8px}
      .routeMetrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .routeMetric{padding:12px;border-radius:12px;background:var(--subtle)}
      .routeMetric span{display:block;color:var(--muted);font-size:11px}.routeMetric strong{font-size:20px}
      .weatherNow{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
      .weatherTile{padding:12px;border-radius:12px;background:var(--subtle)}
      .weatherTile span{display:block;color:var(--muted);font-size:11px}.weatherTile strong{font-size:18px}
      .gpsDetail{display:grid;gap:7px;margin-top:12px;font-size:13px}.gpsDetail div{display:flex;justify-content:space-between;gap:12px}.gpsDetail span{color:var(--muted)}
      .apiNote{font-size:12px;color:var(--muted);margin-top:10px;line-height:1.45}
      .leaflet-control-attribution{font-size:10px}
      @media(max-width:1080px){.mobilityGrid{grid-template-columns:1fr}}
      @media(max-width:760px){
        #busMap{height:390px}.mobileNav.buscheck-six{grid-template-columns:repeat(6,1fr)}
        .mobileNav.buscheck-six button{font-size:10px;padding:0 2px}.mobilityMapCard{padding:10px}
        .routeMetrics,.weatherNow{grid-template-columns:1fr 1fr}
      }
    `;
    document.head.appendChild(style);
  }

  function loadLeaflet(){
    if(window.L) return Promise.resolve(window.L);
    return new Promise(function(resolve,reject){
      var css=document.createElement("link");
      css.rel="stylesheet";
      css.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      css.integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";
      css.crossOrigin="";
      document.head.appendChild(css);

      var s=document.createElement("script");
      s.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
      s.integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";
      s.crossOrigin="";
      s.onload=function(){resolve(window.L)};
      s.onerror=function(){reject(new Error("leaflet_load_failed"))};
      document.head.appendChild(s);
    });
  }

  function addNavigation(){
    var desktop=document.querySelector("aside .nav");
    if(desktop && !desktop.querySelector('[data-view="mobility"]')){
      var b=document.createElement("button");
      b.setAttribute("data-view","mobility");
      b.textContent="Bản đồ & GPS";
      var scanner=desktop.querySelector('[data-view="scanner"]');
      desktop.insertBefore(b,scanner||null);
      b.addEventListener("click",function(){openMobility()});
    }

    var mobile=document.querySelector(".mobileNav");
    if(mobile && !mobile.querySelector('[data-view="mobility"]')){
      mobile.classList.add("buscheck-six");
      var mb=document.createElement("button");
      mb.setAttribute("data-view","mobility");
      mb.textContent="GPS";
      var scan=mobile.querySelector('[data-view="scanner"]');
      mobile.insertBefore(mb,scan||null);
      mb.addEventListener("click",function(){openMobility()});
    }
    if(window.titles) window.titles.mobility="Bản đồ & GPS";
  }

  function addView(){
    if(document.getElementById("view-mobility")) return;
    var section=document.createElement("section");
    section.className="view";
    section.id="view-mobility";
    section.innerHTML=`
      <div class="sectionHead">
        <div><h2>Bản đồ & GPS xe</h2><p>Dùng GPS thật của điện thoại để theo dõi vị trí, tìm đường và xem thời tiết tại xe.</p></div>
        <div class="filters"><span class="badge info" id="gpsTopBadge"><span class="dot"></span> GPS chưa bật</span></div>
      </div>
      <div class="mobilityGrid">
        <article class="card mobilityMapCard">
          <div class="mobilityToolbar">
            <button class="btn primary" id="gpsToggle">Bắt đầu GPS</button>
            <button class="btn secondary" id="centerGps" disabled>Về vị trí xe</button>
            <button class="btn secondary" id="clearRoute">Xóa tuyến</button>
          </div>
          <div class="mobilityStatus"><span class="badge info" id="syncBadge">Đồng bộ: thiết bị này</span><small id="gpsHint">Cho phép quyền vị trí để bắt đầu.</small></div>
          <div id="busMap" aria-label="Bản đồ vị trí xe"></div>
          <div class="apiNote">Bản đồ © OpenStreetMap contributors. Vị trí xe chỉ được lấy khi người dùng cấp quyền GPS. BusCheck không tạo vị trí giả.</div>
        </article>

        <div class="mobilitySide">
          <article class="card panel">
            <div class="panelHead"><div><h3>Tìm đường</h3><p>Điểm đi để trống sẽ dùng GPS hiện tại của xe.</p></div></div>
            <div class="routeForm">
              <div><label for="routeOrigin">Điểm đi</label><input id="routeOrigin" placeholder="Để trống = vị trí xe"></div>
              <div><label for="routeDestination">Điểm đến</label><input id="routeDestination" placeholder="Nhập tên trường, địa chỉ hoặc lat,lon"></div>
              <div class="routeActions">
                <button class="btn secondary" id="useGpsOrigin">Dùng GPS xe</button>
                <button class="btn primary" id="routeBtn">Tìm đường</button>
              </div>
            </div>
            <div class="routeResult" id="routeResult">
              <span class="badge info">Chưa có tuyến</span>
              <p class="apiNote">ETA là thời gian cơ sở từ OSRM/OpenStreetMap, chưa bao gồm giao thông thời gian thực.</p>
            </div>
          </article>

          <article class="card panel">
            <div class="panelHead"><div><h3>GPS hiện tại</h3><p>Thông số lấy trực tiếp từ trình duyệt của thiết bị.</p></div></div>
            <div class="gpsDetail" id="gpsDetail">
              <div><span>Vĩ độ</span><strong>—</strong></div>
              <div><span>Kinh độ</span><strong>—</strong></div>
              <div><span>Độ chính xác</span><strong>—</strong></div>
              <div><span>Tốc độ</span><strong>—</strong></div>
              <div><span>Cập nhật</span><strong>—</strong></div>
            </div>
          </article>

          <article class="card panel">
            <div class="panelHead"><div><h3>Thời tiết tại xe</h3><p>Open-Meteo cập nhật theo tọa độ GPS.</p></div><button class="btn ghost" id="refreshWeather">Làm mới</button></div>
            <div id="weatherStatus"><span class="badge info">Chờ GPS</span></div>
            <div class="weatherNow" id="weatherNow">
              <div class="weatherTile"><span>Nhiệt độ</span><strong>—</strong></div>
              <div class="weatherTile"><span>Mưa</span><strong>—</strong></div>
              <div class="weatherTile"><span>Gió</span><strong>—</strong></div>
              <div class="weatherTile"><span>Độ ẩm</span><strong>—</strong></div>
            </div>
          </article>
        </div>
      </div>
    `;
    var scanner=document.getElementById("view-scanner");
    if(scanner && scanner.parentNode) scanner.parentNode.insertBefore(section,scanner);
    else document.querySelector("main").appendChild(section);
  }

  function initMap(){
    if(state.map || !window.L) return;
    state.L=window.L;
    state.map=state.L.map("busMap",{zoomControl:true}).setView([15.9,107.8],5);
    state.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxZoom:19,
      attribution:"&copy; OpenStreetMap contributors"
    }).addTo(state.map);
    setTimeout(function(){state.map.invalidateSize()},100);
  }

  function openMobility(){
    if(typeof window.showView==="function") window.showView("mobility");
    setTimeout(function(){if(state.map) state.map.invalidateSize()},120);
  }

  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g,function(c){return({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]});
  }

  function fmtTime(ts){
    try{return new Date(ts).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit",second:"2-digit"})}catch(e){return "—"}
  }
  function fmtSpeed(v){
    if(v==null || !isFinite(v)) return "—";
    return (v*3.6).toFixed(1)+" km/h";
  }
  function setGpsBadge(kind,text){
    var b=document.getElementById("gpsTopBadge");
    if(!b) return;
    b.className="badge "+kind;
    b.innerHTML='<span class="dot"></span> '+esc(text);
  }

  function emitGps(payload){
    try{
      localStorage.setItem("buscheck:last-gps",JSON.stringify(payload));
      window.dispatchEvent(new CustomEvent("buscheck:gps",{detail:payload}));
      if(typeof window.buscheckPersistGps==="function"){
        Promise.resolve(window.buscheckPersistGps(payload)).catch(function(){});
      }
    }catch(e){}
  }

  function updateGpsUI(pos){
    var c=pos.coords;
    var payload={
      lat:Number(c.latitude), lon:Number(c.longitude),
      accuracy:c.accuracy==null?null:Number(c.accuracy),
      speed:c.speed==null?null:Number(c.speed),
      heading:c.heading==null?null:Number(c.heading),
      timestamp:pos.timestamp||Date.now()
    };
    state.latestGps=payload;
    emitGps(payload);

    var detail=document.getElementById("gpsDetail");
    if(detail){
      detail.innerHTML=
        '<div><span>Vĩ độ</span><strong>'+payload.lat.toFixed(6)+'</strong></div>'+
        '<div><span>Kinh độ</span><strong>'+payload.lon.toFixed(6)+'</strong></div>'+
        '<div><span>Độ chính xác</span><strong>'+(payload.accuracy==null?"—":Math.round(payload.accuracy)+" m")+'</strong></div>'+
        '<div><span>Tốc độ</span><strong>'+fmtSpeed(payload.speed)+'</strong></div>'+
        '<div><span>Cập nhật</span><strong>'+fmtTime(payload.timestamp)+'</strong></div>';
    }
    document.getElementById("gpsHint").textContent="GPS đang cập nhật liên tục trên thiết bị này.";
    setGpsBadge("success","GPS đang hoạt động");
    document.getElementById("centerGps").disabled=false;

    if(state.map){
      var ll=[payload.lat,payload.lon];
      if(!state.gpsMarker){
        state.gpsMarker=state.L.marker(ll).addTo(state.map).bindPopup("<b>Vị trí xe</b><br>GPS thiết bị");
      }else state.gpsMarker.setLatLng(ll);
      if(!state.accuracyCircle){
        state.accuracyCircle=state.L.circle(ll,{radius:payload.accuracy||10,weight:1,fillOpacity:.08}).addTo(state.map);
      }else{
        state.accuracyCircle.setLatLng(ll);
        state.accuracyCircle.setRadius(payload.accuracy||10);
      }
      if(!state.origin) state.map.setView(ll,16);
    }

    var now=Date.now();
    if(now-state.lastWeatherAt>10*60*1000) refreshWeather();
  }

  function showRemoteVehicleLocation(payload,label){
    if(!payload || !isFinite(payload.lat) || !isFinite(payload.lon)) return;
    state.remoteLatest={
      lat:Number(payload.lat),lon:Number(payload.lon),
      accuracy:payload.accuracy_m==null?null:Number(payload.accuracy_m),
      speed:payload.speed_mps==null?null:Number(payload.speed_mps),
      heading:payload.heading_deg==null?null:Number(payload.heading_deg),
      recorded_at:payload.recorded_at||payload.updated_at||new Date().toISOString()
    };
    var sync=document.getElementById("syncBadge");
    if(sync){sync.className="badge success";sync.textContent="Realtime: "+(label||"xe đang trực tuyến")}
    var hint=document.getElementById("gpsHint");
    if(hint) hint.textContent="Đang nhận vị trí xe từ Supabase Realtime.";
    var center=document.getElementById("centerGps");
    if(center) center.disabled=false;

    if(state.map){
      var ll=[state.remoteLatest.lat,state.remoteLatest.lon];
      if(!state.remoteMarker){
        state.remoteMarker=state.L.circleMarker(ll,{radius:10,weight:3,fillOpacity:.72}).addTo(state.map);
      }else state.remoteMarker.setLatLng(ll);
      state.remoteMarker.bindPopup("<b>"+esc(label||"Xe BusCheck")+"</b><br>Realtime · "+esc(fmtTime(state.remoteLatest.recorded_at)));
      if(!state.remoteAccuracy){
        state.remoteAccuracy=state.L.circle(ll,{radius:state.remoteLatest.accuracy||10,weight:1,fillOpacity:.04}).addTo(state.map);
      }else{
        state.remoteAccuracy.setLatLng(ll);
        state.remoteAccuracy.setRadius(state.remoteLatest.accuracy||10);
      }
      if(state.watchId==null) state.map.setView(ll,16);
    }

    var parentSmall=document.querySelector("#view-parent .childInfo small");
    if(parentSmall){
      parentSmall.textContent=(label||"Xe")+" · cập nhật "+fmtTime(state.remoteLatest.recorded_at)+" · GPS realtime";
    }
  }

  function gpsError(err){
    var text="Không lấy được GPS";
    if(err && err.code===1) text="Chưa cấp quyền vị trí";
    else if(err && err.code===2) text="Thiết bị chưa xác định được vị trí";
    else if(err && err.code===3) text="GPS phản hồi quá lâu";
    setGpsBadge("danger",text);
    document.getElementById("gpsHint").textContent=text+". Kiểm tra quyền Location/GPS của trình duyệt.";
  }

  function startGps(){
    if(!navigator.geolocation){
      gpsError({code:2}); return;
    }
    if(state.watchId!=null) return;
    setGpsBadge("info","Đang lấy vị trí...");
    state.watchId=navigator.geolocation.watchPosition(updateGpsUI,gpsError,{
      enableHighAccuracy:true, maximumAge:5000, timeout:15000
    });
    document.getElementById("gpsToggle").textContent="Dừng GPS";
  }

  function stopGps(){
    if(state.watchId!=null && navigator.geolocation) navigator.geolocation.clearWatch(state.watchId);
    state.watchId=null;
    document.getElementById("gpsToggle").textContent="Bắt đầu GPS";
    setGpsBadge("info","GPS đã dừng");
    document.getElementById("gpsHint").textContent="Vị trí cuối vẫn được giữ trên bản đồ.";
  }

  function parseCoords(text){
    var m=String(text||"").trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;]\s*(-?\d+(?:\.\d+)?)$/);
    if(!m) return null;
    var lat=Number(m[1]),lon=Number(m[2]);
    if(lat<-90||lat>90||lon<-180||lon>180) return null;
    return {lat:lat,lon:lon,label:lat.toFixed(6)+", "+lon.toFixed(6)};
  }

  async function geocode(text){
    var direct=parseCoords(text);
    if(direct) return direct;
    var q=String(text||"").trim();
    if(!q) throw new Error("empty_address");
    var url="https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=vn&accept-language=vi&q="+encodeURIComponent(q);
    var res=await fetch(url,{headers:{"Accept":"application/json"}});
    if(!res.ok) throw new Error("geocode_http_"+res.status);
    var data=await res.json();
    if(!Array.isArray(data)||!data.length) throw new Error("not_found");
    return {lat:Number(data[0].lat),lon:Number(data[0].lon),label:data[0].display_name||q};
  }

  function routeLoading(text){
    var box=document.getElementById("routeResult");
    box.innerHTML='<span class="badge info">'+esc(text)+'</span>';
  }

  async function calculateRoute(){
    var oText=document.getElementById("routeOrigin").value.trim();
    var dText=document.getElementById("routeDestination").value.trim();
    if(!dText){
      routeLoading("Hãy nhập điểm đến");
      document.getElementById("routeDestination").focus();
      return;
    }
    routeLoading("Đang tìm vị trí...");
    try{
      var origin=oText?await geocode(oText):(state.latestGps?{lat:state.latestGps.lat,lon:state.latestGps.lon,label:"Vị trí GPS của xe"}:null);
      if(!origin) throw new Error("gps_required");
      var destination=await geocode(dText);
      state.origin=origin;state.destination=destination;
      routeLoading("Đang tính tuyến...");
      var url="https://router.project-osrm.org/route/v1/driving/"+
        origin.lon+","+origin.lat+";"+destination.lon+","+destination.lat+
        "?overview=full&geometries=geojson&steps=true";
      var res=await fetch(url);
      if(!res.ok) throw new Error("route_http_"+res.status);
      var data=await res.json();
      if(data.code!=="Ok"||!data.routes||!data.routes.length) throw new Error("no_route");
      var route=data.routes[0];

      if(state.routeLayer) state.map.removeLayer(state.routeLayer);
      state.routeLayer=state.L.geoJSON(route.geometry,{style:{weight:6,opacity:.82}}).addTo(state.map);
      state.L.marker([origin.lat,origin.lon]).addTo(state.routeLayer).bindPopup("<b>Điểm đi</b><br>"+esc(origin.label));
      state.L.marker([destination.lat,destination.lon]).addTo(state.routeLayer).bindPopup("<b>Điểm đến</b><br>"+esc(destination.label));
      state.map.fitBounds(state.routeLayer.getBounds(),{padding:[28,28]});

      var km=route.distance/1000, mins=Math.max(1,Math.round(route.duration/60));
      document.getElementById("routeResult").innerHTML=
        '<span class="badge success">Đã tìm thấy tuyến</span>'+
        '<div class="routeMetrics">'+
          '<div class="routeMetric"><span>Quãng đường</span><strong>'+km.toFixed(1)+' km</strong></div>'+
          '<div class="routeMetric"><span>ETA cơ sở</span><strong>'+mins+' phút</strong></div>'+
        '</div>'+
        '<div class="apiNote"><b>Điểm đi:</b> '+esc(origin.label)+'<br><b>Điểm đến:</b> '+esc(destination.label)+'</div>'+
        '<p class="apiNote">ETA này dựa trên mạng đường OSRM/OpenStreetMap và chưa tính tắc đường thời gian thực.</p>';
    }catch(e){
      var msg="Không tìm được tuyến. Hãy kiểm tra địa chỉ và thử lại.";
      if(e.message==="gps_required") msg="Hãy bật GPS hoặc nhập điểm đi.";
      if(e.message==="not_found") msg="Không tìm thấy một trong các địa chỉ.";
      routeLoading(msg);
    }
  }

  function weatherLabel(code){
    code=Number(code);
    if(code===0) return "Trời quang";
    if([1,2,3].indexOf(code)>=0) return "Có mây";
    if([45,48].indexOf(code)>=0) return "Sương mù";
    if((code>=51&&code<=67)||(code>=80&&code<=82)) return "Có mưa";
    if(code>=71&&code<=77) return "Có tuyết";
    if(code>=95) return "Dông";
    return "Thời tiết hiện tại";
  }

  async function refreshWeather(){
    if(!state.latestGps){
      document.getElementById("weatherStatus").innerHTML='<span class="badge warning">Cần bật GPS</span>';
      return;
    }
    var p=state.latestGps;
    document.getElementById("weatherStatus").innerHTML='<span class="badge info">Đang cập nhật...</span>';
    try{
      var url="https://api.open-meteo.com/v1/forecast?latitude="+encodeURIComponent(p.lat)+
        "&longitude="+encodeURIComponent(p.lon)+
        "&current=temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m&timezone=auto";
      var res=await fetch(url);
      if(!res.ok) throw new Error("weather_http_"+res.status);
      var data=await res.json(), c=data.current||{}, u=data.current_units||{};
      state.lastWeatherAt=Date.now();
      var precip=Number(c.precipitation||0);
      document.getElementById("weatherStatus").innerHTML='<span class="badge '+(precip>0?"warning":"success")+'">'+esc(weatherLabel(c.weather_code))+'</span>';
      document.getElementById("weatherNow").innerHTML=
        '<div class="weatherTile"><span>Nhiệt độ</span><strong>'+esc(c.temperature_2m==null?"—":c.temperature_2m+" "+(u.temperature_2m||"°C"))+'</strong></div>'+
        '<div class="weatherTile"><span>Lượng mưa</span><strong>'+esc(c.precipitation==null?"—":c.precipitation+" "+(u.precipitation||"mm"))+'</strong></div>'+
        '<div class="weatherTile"><span>Gió</span><strong>'+esc(c.wind_speed_10m==null?"—":c.wind_speed_10m+" "+(u.wind_speed_10m||"km/h"))+'</strong></div>'+
        '<div class="weatherTile"><span>Độ ẩm</span><strong>'+esc(c.relative_humidity_2m==null?"—":c.relative_humidity_2m+" "+(u.relative_humidity_2m||"%"))+'</strong></div>';
    }catch(e){
      document.getElementById("weatherStatus").innerHTML='<span class="badge danger">Không tải được thời tiết</span>';
    }
  }

  function bindEvents(){
    document.getElementById("gpsToggle").addEventListener("click",function(){state.watchId==null?startGps():stopGps()});
    document.getElementById("centerGps").addEventListener("click",function(){
      var p=state.latestGps||state.remoteLatest;
      if(p&&state.map) state.map.setView([p.lat,p.lon],17);
    });
    document.getElementById("clearRoute").addEventListener("click",function(){
      if(state.routeLayer&&state.map){state.map.removeLayer(state.routeLayer);state.routeLayer=null}
      state.origin=null;state.destination=null;
      document.getElementById("routeResult").innerHTML='<span class="badge info">Chưa có tuyến</span><p class="apiNote">ETA là thời gian cơ sở từ OSRM/OpenStreetMap, chưa bao gồm giao thông thời gian thực.</p>';
    });
    document.getElementById("useGpsOrigin").addEventListener("click",function(){
      document.getElementById("routeOrigin").value="";
      document.getElementById("routeOrigin").placeholder=state.latestGps?"Đang dùng GPS hiện tại của xe":"Bật GPS để dùng vị trí xe";
    });
    document.getElementById("routeBtn").addEventListener("click",calculateRoute);
    document.getElementById("routeDestination").addEventListener("keydown",function(e){if(e.key==="Enter") calculateRoute()});
    document.getElementById("refreshWeather").addEventListener("click",refreshWeather);
  }

  function restoreLastGps(){
    try{
      var saved=JSON.parse(localStorage.getItem("buscheck:last-gps")||"null");
      if(saved&&isFinite(saved.lat)&&isFinite(saved.lon)){
        state.latestGps=saved;
        var fake={coords:{latitude:saved.lat,longitude:saved.lon,accuracy:saved.accuracy,speed:saved.speed,heading:saved.heading},timestamp:saved.timestamp};
        updateGpsUI(fake);
        stopGps();
        setGpsBadge("info","GPS chưa bật");
        document.getElementById("gpsHint").textContent="Đang hiển thị vị trí cuối đã lưu trên thiết bị. Bật GPS để cập nhật.";
      }
    }catch(e){}
  }

  function bootstrap(){
    addStyles();
    addNavigation();
    addView();
    bindEvents();
    loadLeaflet().then(function(){
      initMap();
      restoreLastGps();
    }).catch(function(){
      var box=document.getElementById("busMap");
      if(box) box.innerHTML='<div style="padding:24px">Không tải được thư viện bản đồ. Hãy kiểm tra kết nối mạng.</div>';
    });

    window.BusCheckMobility={
      startGps:startGps,
      stopGps:stopGps,
      refreshWeather:refreshWeather,
      calculateRoute:calculateRoute,
      showRemoteVehicleLocation:showRemoteVehicleLocation,
      getLatestGps:function(){return state.latestGps},
      getRemoteGps:function(){return state.remoteLatest}
    };
  }

  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",bootstrap);
  else bootstrap();
})();
