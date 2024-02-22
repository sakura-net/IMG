var map = L.map("map", {
  maxBounds: [
    [-85.0, -180.0],
    [85.0, 180.0],
  ],
}).setView([0, 0], 2);
var loc = new Array();
L.tileLayer("https://map.cfornas.casa/services/google/tiles/{z}/{x}/{y}.jpg", {
  maxZoom: 4,
  zoomControl: false,
  minZoom: 2,
  attribution: "© Google Map",
}).addTo(map);

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
