// 仅使用 jQuery，左侧透明黑色浮动信息框，接收 WebSocket 数据并在地图上高亮国家
// 把下面代码放在页面 <script> 标签里（确保 jQuery 和 Leaflet 已经在页面中引入）
// 需要一份 world-countries.geojson（或等效 GeoJSON 文件），路径请改成实际路径："/data/world-countries.geojson"

(function ($) {
  // --- 配置区（按需修改） ---
  var GEOJSON_PATH = "/data/world-countries.geojson"; // ← 改成你的 geojson 路径
  var WS_URL = "wss://monitor.cfornas.casa/ws"; // ← 改成你的 WS 地址
  var ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 分钟内有活动视为在线（可调整）

  // --- 初始化 Leaflet 地图 ---
  var map = L.map("map", {
    maxBounds: [
      [-85.0, -180.0],
      [85.0, 180.0],
    ],
    zoomControl: false, // 放到 map options（你要求禁用默认缩放控件）
  }).setView([0, 0], 2);

  L.tileLayer("https://map.cfornas.casa/services/google/tiles/{z}/{x}/{y}.jpg", {
    maxZoom: 4,
    minZoom: 2,
    attribution: "© Google Map",
  }).addTo(map);

  // 可选：添加自定义缩放控件到右侧（如果需要）
  L.control.zoom({ position: "topright" }).addTo(map);

  // 图层组：高亮的国家都会加到这里，方便统一清除/重绘
  var countriesLayer = L.layerGroup().addTo(map);

  // --- 加载 GeoJSON（使用 jQuery） ---
  var ct = null;
  var pendingMessages = []; // 在 ct 未加载前缓存消息
  $.getJSON(GEOJSON_PATH)
    .done(function (data) {
      ct = data;
      // 如果有缓存的消息，先处理第一条（通常你只会收到实时最新一条）
      while (pendingMessages.length) {
        processMessage(pendingMessages.shift());
      }
    })
    .fail(function (err) {
      console.error("加载 GeoJSON 失败：", err);
    });

  // --- 创建左侧浮动信息控件（牛皮癣） ---
  // 使用 Leaflet 控件模式，但内容用 jQuery 构建并设置透明黑背景
  var StatsControl = L.Control.extend({
    options: { position: "topleft" },
    onAdd: function (map) {
      var container = L.DomUtil.create("div", "leaflet-stats-control");
      // 使用 jQuery 生成内容，避免冒泡和地图拖动干扰
      $(container).css({
        "background": "rgba(0,0,0,0.55)", // 黑色透明背景
        "color": "#fff",
        "padding": "10px",
        "border-radius": "8px",
        "box-shadow": "0 2px 6px rgba(0,0,0,0.4)",
        "min-width": "200px",
        "font-family": "Arial, Helvetica, sans-serif",
        "font-size": "13px",
        "line-height": "1.4",
        "pointer-events": "auto", // 确保可以滚动/点击控件内容
      });

      // 防止控件导致地图拖动或缩放
      L.DomEvent.disableClickPropagation(container);
      L.DomEvent.disableScrollPropagation(container);

      // 初始 HTML
      $(container).html(
        '<div style="font-weight:700;margin-bottom:6px;">服务器实时统计</div>' +
          '<div class="stat-row"><span>累计流量:</span> <span class="val total-traffic">-</span></div>' +
          '<div class="stat-row"><span>瞬时流量:</span> <span class="val instant-traffic">-</span></div>' +
          '<div class="stat-row"><span>在线服务器:</span> <span class="val online-count">-</span></div>' +
          '<div class="stat-row"><span>离线服务器:</span> <span class="val offline-count">-</span></div>' +
          '<div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.8);" class="last-update">最后更新时间: -</div>'
      );

      return container;
    },
  });

  var statsControl = new StatsControl();
  statsControl.addTo(map);

  // 工具：格式化字节为合适单位（保留两位）
  function fmtBytes(bytes) {
    if (!isFinite(bytes) || bytes === 0) return "0 B";
    var thresh = 1024;
    if (Math.abs(bytes) < thresh) return bytes + " B";
    var units = ["KB", "MB", "GB", "TB", "PB"];
    var u = -1;
    do {
      bytes /= thresh;
      ++u;
    } while (Math.abs(bytes) >= thresh && u < units.length - 1);
    return bytes.toFixed(2) + " " + units[u];
  }

  // 工具：格式化速率（B/s -> KB/s 或更大）
  function fmtRate(bytesPerSec) {
    return fmtBytes(bytesPerSec) + "/s";
  }

  // 处理并显示 websocket 消息（如果 ct 未就绪则缓存）
  function processMessage(msgObj) {
    // msgObj 结构参见你提供的示例：{ now:..., servers: [...] }
    if (!msgObj || !Array.isArray(msgObj.servers)) return;

    // 清除之前国家图层（我们只保留最新高亮）
    countriesLayer.clearLayers();

    var nowMs = Date.now();
    var totalTrafficBytes = 0; // 累计 NetInTransfer + NetOutTransfer（字节）
    var totalInstantBytesPerSec = 0; // 累计 NetInSpeed + NetOutSpeed（字节/秒）
    var onlineCount = 0;
    var offlineCount = 0;

    // 用于避免同一国家多次叠加：通过 ISO_A2 记录已绘制的国家
    var drawnCountries = new Set();

    msgObj.servers.forEach(function (server) {
      var host = server.Host || {};
      var state = server.State || {};

      // 累计流量（后端字段示例为 bytes）
      var inT = Number(state.NetInTransfer) || 0;
      var outT = Number(state.NetOutTransfer) || 0;
      totalTrafficBytes += inT + outT;

      // 瞬时速率（后端字段示例为 bytes/s）
      var inSpeed = Number(state.NetInSpeed) || 0;
      var outSpeed = Number(state.NetOutSpeed) || 0;
      totalInstantBytesPerSec += inSpeed + outSpeed;

      // 在线/离线判断：使用 LastActive（如果没有，则算离线）
      var lastActive = server.LastActive ? Date.parse(server.LastActive) : 0;
      if (lastActive && Math.abs(nowMs - lastActive) <= ONLINE_THRESHOLD_MS) {
        onlineCount++;
      } else {
        offlineCount++;
      }

      // 高亮国家（仅当 country code 可用且 geojson 已加载）
      var cc = (host.CountryCode || "").toUpperCase().trim();
      if (ct && cc) {
        // 避免同一国家重复绘制
        if (!drawnCountries.has(cc)) {
          // 尝试匹配 ISO_A2 首先；有些 GeoJSON 可能用 ISO_A2 或 ADMIN_A2（尽量兼容）
          var match = ct.features.find(function (f) {
            var props = f.properties || {};
            var isoA2 = (props.ISO_A2 || props.iso_a2 || props.ISO2 || "").toString().toUpperCase();
            return isoA2 === cc;
          });

          if (match) {
            drawnCountries.add(cc);
            L.geoJson(match, {
              style: function () {
                return {
                  color: "#ffcc00",
                  weight: 2,
                  fillOpacity: 0.15,
                };
              },
              onEachFeature: function (feature, layer) {
                // 可加入 tooltip 显示国家名
                var name = (feature.properties && (feature.properties.name || feature.properties.ADMIN || feature.properties.NAME)) || cc;
                layer.bindTooltip(name, { sticky: true });
              },
            }).addTo(countriesLayer);
          }
        }
      }
    });

    // 更新控件显示（格式化数字）
    var $ctrl = $(".leaflet-stats-control");
    $ctrl.find(".total-traffic").text(fmtBytes(totalTrafficBytes));
    $ctrl.find(".instant-traffic").text(fmtRate(totalInstantBytesPerSec));
    $ctrl.find(".online-count").text(onlineCount);
    $ctrl.find(".offline-count").text(offlineCount);
    $ctrl.find(".last-update").text("最后更新时间: " + new Date().toLocaleString());
  }

  // --- WebSocket 处理（保持连接，不自动 close） ---
  var ws;
  try {
    ws = new WebSocket(WS_URL);
  } catch (e) {
    console.error("WebSocket 创建失败:", e);
  }

  if (ws) {
    ws.onopen = function () {
      console.log("ws open");
    };

    ws.onmessage = function (evt) {
      var msgText = evt.data;
      var parsed;
      try {
        parsed = JSON.parse(msgText);
      } catch (e) {
        console.warn("收到非 JSON 消息：", e);
        return;
      }

      // 如果 ct 未加载，先缓存；否则直接处理
      if (!ct) {
        pendingMessages.push(parsed);
      } else {
        processMessage(parsed);
      }
    };

    ws.onerror = function (err) {
      console.error("ws error", err);
    };

    ws.onclose = function (ev) {
      console.warn("ws closed", ev);
      // 如果需要自动重连可在此实现（本示例不自动重连）
    };
  }

  // --- 小提示：页面关闭时关闭 ws（避免悬空连接） ---
  $(window).on("beforeunload", function () {
    try {
      if (ws && ws.readyState === WebSocket.OPEN) ws.close();
    } catch (e) {}
  });

  // --- 额外样式（如果想更紧凑，可调整） ---
  // 使用 jQuery 给控件内的行设置布局
  $(document).ready(function () {
    // 当控件存在时设置每行的样式
    var $c = $(".leaflet-stats-control");
    $c.find(".stat-row").css({
      display: "flex",
      "justify-content": "space-between",
      "margin-top": "4px",
    });
    $c.find(".stat-row .val").css({ "font-weight": "600" });
  });
})(jQuery);
