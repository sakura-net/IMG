// 动态加载外部 JS 库
function loadScript(url, callback) {
  var s = document.createElement('script');
  s.src = url;
  s.onload = callback;
  document.head.appendChild(s);
}

// 动态加载 CSS 文件
function loadCSS(url) {
  var l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = url;
  document.head.appendChild(l);
}

// 加载 Leaflet CSS
loadCSS('https://unpkg.com/leaflet/dist/leaflet.css');

// 按顺序加载库
loadScript('https://unpkg.com/leaflet/dist/leaflet.js', function() {
  loadScript('https://unpkg.com/maplibre-gl/dist/maplibre-gl.js', function() {
    loadScript('https://unpkg.com/mapbox-gl-leaflet/leaflet-mapbox-gl.js', function() {

      // 创建地图
      var map = L.map('map').setView([28.6135, -12.2168], 2);

      // 使用 Mapbox-GL 插件加载 PBF 瓦片
      L.mapboxGL({
        style: {
          version: 8,
          glyphs: "https://demotiles.maplibre.org/fonts/{fontstack}/{range}.pbf",
          sources: {
            "openmaptiles": {
              type: "vector",
              tiles: ["https://map.cfornas.casa/services/google/tiles/{z}/{x}/{y}.pbf"],
              minzoom: 0,
              maxzoom: 12
            }
          },
          layers: [
            // 水体
            { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#a0c8f0" } }
          ]
        }
      }).addTo(map);

    });
  });
});


var ws = new WebSocket("wss://monitor.cfornas.casa/ws");
ws.onopen = function () {
  console.log("open");
};
ws.onmessage = function (msg) {
  var mj = JSON.parse(msg.data);
  for (let index = 0; index < mj.servers.length; index++) {
    L.geoJson(
        ct.features.filter(function (feature) {
            return feature.properties.ISO_A2 === mj.servers[index].Host.CountryCode.toUpperCase();
          })
    ).addTo(map);
  }
  ws.close();
};
// 新的 WebSocket 专门统计流量/服务器数量
var wsStats = new WebSocket("wss://monitor.cfornas.casa/ws");

wsStats.onopen = function () {
  console.log("stats ws open");
};

// 添加浮层 DOM（只加一次）
if ($("#server-stats").length === 0) {
  $("body").append(
    '<div id="server-stats">' +
      '<div class="title">服务器实时统计</div>' +
      '<div class="row"><span>累计流量:</span><span class="val total-traffic">-</span></div>' +
      '<div class="row"><span>瞬时流量:</span><span class="val instant-traffic">-</span></div>' +
      '<div class="row"><span>在线服务器:</span><span class="val online-count">-</span></div>' +
      '<div class="row"><span>离线服务器:</span><span class="val offline-count">-</span></div>' +
      '<div class="last-update">最后更新时间: -</div>' +
    '</div>'
  );

  // 样式：黑色透明背景
  $("#server-stats").css({
    position: "fixed",
    left: "8px",
    top: "8px",
    background: "rgba(0,0,0,0.55)",
    color: "#fff",
    padding: "10px",
    "border-radius": "6px",
    "z-index": 10000,
    "min-width": "200px",
    "font-family": "Arial, Helvetica, sans-serif",
    "font-size": "13px",
    "line-height": "1.4",
    "box-shadow": "0 2px 6px rgba(0,0,0,0.4)",
    "pointer-events": "auto"
  });
  $("#server-stats .title").css({ "font-weight": "700", "margin-bottom": "6px" });
  $("#server-stats .row").css({ display: "flex", "justify-content": "space-between", "margin-top": "4px" });
  $("#server-stats .val").css({ "font-weight": 600 });
  $("#server-stats .last-update").css({ "margin-top": "6px", "font-size": "11px", color: "rgba(255,255,255,0.8)" });
}

// 工具函数
function fmtBytes(bytes) {
  bytes = Number(bytes) || 0;
  if (bytes < 1024) return bytes + " B";
  var units = ["KB", "MB", "GB", "TB"];
  var i = -1;
  do {
    bytes = bytes / 1024;
    i++;
  } while (bytes >= 1024 && i < units.length - 1);
  return bytes.toFixed(2) + " " + units[i];
}
function fmtRate(bps) {
  return fmtBytes(bps) + "/s";
}

// 收到数据时更新统计
wsStats.onmessage = function (msg) {
  var mj = JSON.parse(msg.data);
  var now = Date.now();

  var totalTraffic = 0;
  var instantTraffic = 0;
  var online = 0;
  var offline = 0;

  mj.servers.forEach(function (s) {
    var st = s.State || {};
    totalTraffic += (Number(st.NetInTransfer) || 0) + (Number(st.NetOutTransfer) || 0);
    instantTraffic += (Number(st.NetInSpeed) || 0) + (Number(st.NetOutSpeed) || 0);

    var last = s.LastActive ? Date.parse(s.LastActive) : 0;
    if (last && now - last < 120000) online++; // 2分钟内算在线
    else offline++;
  });

  $("#server-stats .total-traffic").text(fmtBytes(totalTraffic));
  $("#server-stats .instant-traffic").text(fmtRate(instantTraffic));
  $("#server-stats .online-count").text(online);
  $("#server-stats .offline-count").text(offline);
  $("#server-stats .last-update").text("最后更新时间: " + new Date().toLocaleString());
};
