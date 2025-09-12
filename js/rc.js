// 将此段追加到你现有的 map / tile / 原 ws 之后
(function ($) {
  // 配置：按需改 URL（我默认用跟你原来相同的 WS 地址）
  var WS_REALTIME_URL = "wss://xxxx/ws"; // <- 可改
  var ONLINE_THRESHOLD_MS = 2 * 60 * 1000; // 2 分钟内有活动视为在线

  // 不重复创建 DOM
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

    // 样式（黑色透明背景）
    $("#server-stats").css({
      position: "fixed",
      left: "8px",
      top: "8px",
      "background": "rgba(0,0,0,0.55)",
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

    // 防止事件冒泡到地图导致拖动/缩放
    $("#server-stats").on("mousedown mousewheel touchstart click", function (e) {
      e.stopPropagation();
    });
  }

  // 画国家的 layer（如果 map 存在）
  var realtimeLayer = null;
  try {
    if (typeof map !== "undefined" && map) {
      realtimeLayer = L.layerGroup().addTo(map);
    }
  } catch (e) {
    realtimeLayer = null;
  }

  function fmtBytes(bytes) {
    bytes = Number(bytes) || 0;
    if (!isFinite(bytes) || bytes === 0) return "0 B";
    var sign = bytes < 0 ? "-" : "";
    var abs = Math.abs(bytes);
    var units = ["B", "KB", "MB", "GB", "TB", "PB"];
    var u = 0;
    while (abs >= 1024 && u < units.length - 1) {
      abs = abs / 1024;
      u++;
    }
    return sign + abs.toFixed(2) + " " + units[u];
  }
  function fmtRate(bps) {
    return fmtBytes(bps) + "/s";
  }

  function updateUIAndMap(mj) {
    if (!mj || !Array.isArray(mj.servers)) return;
    var now = Date.now();
    var totalTraffic = 0; // bytes
    var instantRate = 0; // bytes/s
    var online = 0, offline = 0;
    var drawn = new Set();

    // 清图层（但如果 realtimeLayer 不可用就跳过）
    if (realtimeLayer && typeof realtimeLayer.clearLayers === "function") {
      realtimeLayer.clearLayers();
    }

    mj.servers.forEach(function (s) {
      var host = s.Host || {};
      var state = s.State || {};
      var inT = Number(state.NetInTransfer) || 0;
      var outT = Number(state.NetOutTransfer) || 0;
      totalTraffic += inT + outT;
      var inS = Number(state.NetInSpeed) || 0;
      var outS = Number(state.NetOutSpeed) || 0;
      instantRate += inS + outS;

      var last = s.LastActive ? Date.parse(s.LastActive) : 0;
      if (last && Math.abs(now - last) <= ONLINE_THRESHOLD_MS) online++;
      else offline++;

      // 高亮国家：仅在全局 ct 存在且 CountryCode 有值时进行，并避免重复
      var cc = (host.CountryCode || "").toString().trim().toUpperCase();
      if (cc && typeof ct !== "undefined" && ct && Array.isArray(ct.features) && realtimeLayer) {
        if (!drawn.has(cc)) {
          var f = ct.features.find(function (feat) {
            var p = feat.properties || {};
            var iso = (p.ISO_A2 || p.iso_a2 || p.ISO2 || p.ISO || "").toString().toUpperCase();
            return iso === cc;
          });
          if (f) {
            drawn.add(cc);
            try {
              L.geoJson(f, {
                style: function () {
                  return { color: "#ffcc00", weight: 2, fillOpacity: 0.12 };
                }
              }).addTo(realtimeLayer);
            } catch (e) {
              // 保持安静，不打断其它逻辑
              console.warn("绘制国家失败", cc, e);
            }
          }
        }
      }
    });

    // 更新 DOM
    $("#server-stats .total-traffic").text(fmtBytes(totalTraffic));
    $("#server-stats .instant-traffic").text(fmtRate(instantRate));
    $("#server-stats .online-count").text(online);
    $("#server-stats .offline-count").text(offline);
    $("#server-stats .last-update").text("最后更新时间: " + new Date().toLocaleString());
  }

  // 新的 WebSocket 连接（与你原来的 ws 分开）
  var wsRealtime = null;
  try {
    wsRealtime = new WebSocket(WS_REALTIME_URL);
  } catch (e) {
    console.error("创建实时 WS 失败：", e);
  }

  if (wsRealtime) {
    wsRealtime.onopen = function () {
      console.log("wsRealtime open");
    };
    wsRealtime.onmessage = function (evt) {
      var txt = evt.data;
      var parsed = null;
      try {
        parsed = JSON.parse(txt);
      } catch (e) {
        console.warn("实时 WS 收到非 JSON 消息");
        return;
      }
      // 直接处理（如果 ct 尚未加载也不会报错，仅不会绘制国家）
      updateUIAndMap(parsed);
    };
    wsRealtime.onerror = function (err) {
      console.error("wsRealtime error", err);
    };
    wsRealtime.onclose = function (ev) {
      console.warn("wsRealtime closed", ev);
      // 本示例不自动重连，若需要可在此实现重连逻辑
    };

    // 离开页面时关闭
    $(window).on("beforeunload", function () {
      try {
        if (wsRealtime && wsRealtime.readyState === WebSocket.OPEN) wsRealtime.close();
      } catch (e) {}
    });
  }
})(jQuery);
