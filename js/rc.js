// 假设 HTML 有 <div id="map"></div>，并且已在页面中加载 Leaflet、MapLibre GL、mapbox-gl-leaflet

// 创建 Leaflet 地图
var map = L.map("map", {
  maxBounds: [
    [-85.0, -180.0],
    [85.0, 180.0],
  ],
}).setView([0, 0], 2);

// 使用 mapbox-gl-leaflet 加载 PBF 瓦片
L.mapboxGL({
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/fonts/{fontstack}/{range}.pbf",
    sources: {
      openmaptiles: {
        type: "vector",
        tiles: ["https://map.cfornas.casa/services/google/tiles/{z}/{x}/{y}.pbf"],
        minzoom: 0,
        maxzoom: 12
      }
    },
    layers: [
      // 道路
      { id: "roads", type: "line", source: "openmaptiles", "source-layer": "transportation", paint: { "line-color": "#ff0000", "line-width": 1 } },
      // 道路名称
      { id: "road-names", type: "symbol", source: "openmaptiles", "source-layer": "transportation_name",
        layout: {
          "text-field": "{name}",
          "text-font": ["Open Sans Bold"],
          "text-size": 10,
          "symbol-placement": "line"
        },
        paint: { "text-color": "#000000" }
      },
      // 水体
      { id: "water", type: "fill", source: "openmaptiles", "source-layer": "water", paint: { "fill-color": "#a0c8f0" } },
      // 建筑
      { id: "buildings", type: "fill", source: "openmaptiles", "source-layer": "building", paint: { "fill-color": "#c0c0c0" } },
      // 公园/绿地
      { id: "parks", type: "fill", source: "openmaptiles", "source-layer": "park", paint: { "fill-color": "#80c080", "fill-opacity": 0.5 } }
    ]
  }
}).addTo(map);

// --- WebSocket 与浮层统计逻辑保留 ---
var ws = new WebSocket("wss://monitor.cfornas.casa/ws");
ws.onopen = function () { console.log("open"); };
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

var wsStats = new WebSocket("wss://monitor.cfornas.casa/ws");
wsStats.onopen = function () { console.log("stats ws open"); };
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
    if (last && now - last < 120000) online++;
    else offline++;
  });

  $("#server-stats .total-traffic").text(fmtBytes(totalTraffic));
  $("#server-stats .instant-traffic").text(fmtRate(instantTraffic));
  $("#server-stats .online-count").text(online);
  $("#server-stats .offline-count").text(offline);
  $("#server-stats .last-update").text("最后更新时间: " + new Date().toLocaleString());
};

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
