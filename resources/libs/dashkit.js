/* MyDashie dashboard kit. Requires echarts.min.js loaded first. Exposes window.Dash. */
(function () {
  "use strict";
  var root = document.documentElement;

  // ---------- theme ----------
  var qs = new URLSearchParams(location.search);
  var forced = qs.get("theme");
  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  function applyTheme() {
    var dark = forced ? forced === "dark" : mq.matches;
    root.setAttribute("data-theme", dark ? "dark" : "light");
  }
  applyTheme();
  if (!forced) mq.addEventListener("change", function () { applyTheme(); rerenderAll(); });
  // A staged load is a new version swapped in behind the current one while Dashie works: nothing
  // animates until the host reveals it, and then only the cards that are new.
  var staged = qs.get("staged") === "1";
  if (staged) root.classList.add("dk-staged");

  function css(name) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function palette() { return ["--dk-s1", "--dk-s2", "--dk-s3", "--dk-s4", "--dk-s5", "--dk-s6"].map(css); }

  // ---------- formatting ----------
  var locale = undefined;
  var fmt = {
    number: function (v, d) { return v == null || isNaN(v) ? "–" : Number(v).toLocaleString(locale, { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : d }); },
    compact: function (v) { return v == null || isNaN(v) ? "–" : Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(v); },
    currency: function (v, cur, compact) {
      if (v == null || isNaN(v)) return "–";
      return Intl.NumberFormat(locale, { style: "currency", currency: cur || "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : Math.abs(v) >= 1000 ? 0 : 2 }).format(v);
    },
    percent: function (v, d) { return v == null || isNaN(v) ? "–" : (Number(v) * 100).toFixed(d == null ? 1 : d) + "%"; },
    date: function (v, opts) { var d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleDateString(locale, opts || { month: "short", day: "numeric" }); },
    datetime: function (v) { var d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); },
    asOf: function (v) { var d = new Date(v || (window.DASH && window.DASH.fetchedAt) || Date.now()); return isNaN(d) ? "" : "as of " + d.toLocaleString(locale, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); },
    relative: function (v) {
      var diff = Date.now() - new Date(v).getTime(); if (isNaN(diff)) return "";
      var m = Math.round(diff / 60000); if (m < 1) return "just now"; if (m < 60) return m + " min ago";
      var h = Math.round(m / 60); if (h < 24) return h + " hr ago"; var dd = Math.round(h / 24); return dd === 1 ? "yesterday" : dd + " days ago";
    },
  };
  function format(v, f) {
    if (typeof f === "function") return f(v);
    if (f === "currency") return fmt.currency(v);
    if (f === "currency-compact") return fmt.currency(v, "USD", true);
    if (f === "percent") return fmt.percent(v);
    if (f === "compact") return fmt.compact(v);
    if (f === "date") return fmt.date(v);
    if (f === "datetime") return fmt.datetime(v);
    if (typeof f === "number") return fmt.number(v, f);
    if (typeof v === "number") return Math.abs(v) >= 100000 ? fmt.compact(v) : fmt.number(v, Number.isInteger(v) ? 0 : 1);
    return v == null ? "–" : String(v);
  }

  function el(target) { return typeof target === "string" ? document.querySelector(target) : target; }
  function h(tag, cls, html) { var n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // ---------- data ----------
  function data(name) {
    var all = (window.DASH && window.DASH.data) || {};
    var v = all[name];
    return Array.isArray(v) ? v : v == null ? [] : v;
  }

  // ---------- header ----------
  function header(target, o) {
    o = o || {};
    var n = el(target) || document.body.insertBefore(h("header"), document.body.firstChild);
    n.className = "dk-header";
    var D = window.DASH || {};
    var stale = !!D.staleSince;
    n.innerHTML =
      '<div>' + (o.eyebrow ? '<div class="dk-eyebrow">' + esc(o.eyebrow) + "</div>" : "") +
      '<h1 class="dk-title">' + esc((D.userNamed && D.name) || o.title || D.name || "Dashboard") + "</h1>" +
      (o.subtitle ? '<div class="dk-subtitle">' + esc(o.subtitle) + "</div>" : "") + "</div>" +
      '<div class="dk-updated' + (stale ? " stale" : "") + '" title="' + esc(D.fetchedAt ? fmt.datetime(D.fetchedAt) : "") + '">' +
      (stale ? "Showing data from " + fmt.relative(D.fetchedAt) : "Updated " + fmt.relative(D.fetchedAt)) + "</div>";
    return n;
  }

  // ---------- card shell ----------
  function card(target, o) {
    var n = el(target);
    if (!n) throw new Error("Dash: no element " + target);
    n.classList.add("dk-card");
    n.innerHTML = "";
    var head = h("div", "dk-card-head");
    var titles = h("div", null, (o.title ? '<h3 class="dk-card-title">' + esc(o.title) + "</h3>" : "") + (o.subtitle ? '<div class="dk-card-sub">' + esc(o.subtitle) + "</div>" : ""));
    head.appendChild(titles);
    if (o.title || o.subtitle || o.toggle) n.appendChild(head);
    var body = h("div", o.bodyClass || "dk-chart");
    if (o.height) body.style.minHeight = o.height + "px";
    n.appendChild(body);
    if (o.note) n.appendChild(h("div", "dk-card-foot", esc(o.note)));
    return { root: n, head: head, body: body };
  }

  function empty(target, msg, sub) {
    var n = el(target);
    n.innerHTML = '<div class="dk-empty"><div><b>' + esc(msg || "No data yet") + "</b>" + esc(sub || "This will fill in on the next refresh.") + "</div></div>";
  }

  // ---------- sparkline (inline svg) ----------
  function sparkSvg(values, color) {
    var v = (values || []).filter(function (x) { return x != null && !isNaN(x); }).map(Number);
    if (v.length < 2) return "";
    var w = 96, hh = 34, p = 3, min = Math.min.apply(null, v), max = Math.max.apply(null, v), rng = max - min || 1;
    var pts = v.map(function (y, i) { return [p + (i * (w - 2 * p)) / (v.length - 1), hh - p - ((y - min) / rng) * (hh - 2 * p)]; });
    var d = pts.map(function (q, i) { return (i ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1); }).join(" ");
    var area = d + " L" + pts[pts.length - 1][0].toFixed(1) + " " + hh + " L" + pts[0][0].toFixed(1) + " " + hh + " Z";
    var last = pts[pts.length - 1];
    var id = "g" + Math.random().toString(36).slice(2, 8);
    return '<svg class="dk-kpi-spark" viewBox="0 0 ' + w + " " + hh + '" aria-hidden="true"><defs><linearGradient id="' + id + '" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="' + color + '" stop-opacity="0.22"/><stop offset="1" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + id + ')"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="3" fill="' + color + '" stroke="var(--dk-surface)" stroke-width="2"/></svg>';
  }

  // ---------- KPI ----------
  // Dash.kpi("#k1", { label, value, format, previous, compareLabel: "vs last week", goodWhen: "up"|"down", spark: [..], target, note })
  function kpi(target, o) {
    var n = el(target);
    n.classList.add("dk-card", "dk-kpi");
    var value = Number(o.value);
    var deltaHtml = "";
    if (o.previous != null && !isNaN(o.previous) && Number(o.previous) !== 0) {
      var change = (value - Number(o.previous)) / Math.abs(Number(o.previous));
      var up = change > 0.0005, down = change < -0.0005;
      var goodWhen = o.goodWhen || "up";
      var tone = !up && !down ? "flat" : (up && goodWhen === "up") || (down && goodWhen === "down") ? "good" : "bad";
      var arrow = up ? '<svg viewBox="0 0 10 10"><path d="M5 1.5 9 7H1z" fill="currentColor"/></svg>' : down ? '<svg viewBox="0 0 10 10"><path d="M5 8.5 1 3h8z" fill="currentColor"/></svg>' : "";
      var word = up ? "Up" : down ? "Down" : "Flat";
      deltaHtml = '<span class="dk-delta ' + tone + '" title="' + word + " " + fmt.percent(Math.abs(change)) + '">' + arrow + '<span class="sr">' + (up || down ? fmt.percent(Math.abs(change)) : "0%") + "</span></span>";
    } else if (o.change != null) {
      var c = Number(o.change);
      var t2 = c === 0 ? "flat" : (c > 0) === ((o.goodWhen || "up") === "up") ? "good" : "bad";
      deltaHtml = '<span class="dk-delta ' + t2 + '">' + (c > 0 ? "▲ " : c < 0 ? "▼ " : "") + fmt.percent(Math.abs(c)) + "</span>";
    }
    var color = css("--dk-accent");
    var targetHtml = "";
    if (o.target != null && !isNaN(o.target) && Number(o.target) > 0) {
      var pct = Math.max(0, Math.min(1, value / Number(o.target)));
      targetHtml = '<div class="dk-target"><div class="dk-target-track"><div class="dk-target-fill" style="width:' + (pct * 100).toFixed(1) + '%"></div></div><div class="dk-target-label"><span>' + fmt.percent(pct, 0) + ' of target</span><span>Target ' + esc(format(o.target, o.format)) + "</span></div></div>";
    }
    n.innerHTML =
      '<div class="dk-kpi-label">' + esc(o.label) + "</div>" +
      '<div class="dk-kpi-row"><div class="dk-kpi-value">' + esc(isNaN(value) ? String(o.value ?? "–") : format(value, o.format)) + "</div>" + sparkSvg(o.spark, color) + "</div>" +
      (deltaHtml || o.compareLabel || o.note ? '<div class="dk-kpi-meta">' + deltaHtml + (deltaHtml && o.compareLabel ? "<span>" + esc(o.compareLabel) + "</span>" : "") + (o.note ? "<span>" + esc(o.note) + "</span>" : "") + "</div>" : "") +
      targetHtml;
    return n;
  }

  // ---------- ECharts theme + registry ----------
  var charts = [];
  function baseOption() {
    var ink2 = css("--dk-ink-2"), muted = css("--dk-muted"), grid = css("--dk-grid"), surface = css("--dk-surface"), line = css("--dk-line");
    return {
      color: palette(),
      backgroundColor: "transparent",
      textStyle: { fontFamily: css("--dk-font"), color: ink2 },
      animationDuration: 600,
      animationEasing: "cubicOut",
      grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
      tooltip: {
        trigger: "axis",
        backgroundColor: surface,
        borderColor: line,
        borderWidth: 1,
        padding: [8, 12],
        extraCssText: "border-radius:12px;box-shadow:0 12px 30px -12px rgba(28,27,40,.35);",
        textStyle: { color: css("--dk-ink"), fontSize: 12.5 },
        axisPointer: { type: "line", lineStyle: { color: muted, width: 1, opacity: 0.5 } },
      },
      xAxis: { axisLine: { lineStyle: { color: grid } }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 11.5, hideOverlap: true }, splitLine: { show: false } },
      yAxis: { axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: muted, fontSize: 11.5 }, splitLine: { lineStyle: { color: grid, width: 1 } } },
      legend: { top: 0, right: 0, icon: "roundRect", itemWidth: 10, itemHeight: 10, itemGap: 14, textStyle: { color: ink2, fontSize: 12 } },
    };
  }
  function merge(a, b) {
    if (Array.isArray(b)) return b;
    if (b && typeof b === "object") {
      var out = Object.assign({}, a);
      for (var k in b) out[k] = a && typeof a[k] === "object" && !Array.isArray(a[k]) && typeof b[k] === "object" && !Array.isArray(b[k]) ? merge(a[k], b[k]) : b[k];
      return out;
    }
    return b;
  }
  function withAxes(opt) {
    var base = baseOption();
    var o = merge(base, opt);
    function fix(ax, def) { if (!ax) return ax; return Array.isArray(ax) ? ax.map(function (x) { return merge(def, x); }) : merge(def, ax); }
    if (opt.xAxis) o.xAxis = fix(opt.xAxis, base.xAxis);
    if (opt.yAxis) o.yAxis = fix(opt.yAxis, base.yAxis);
    if (!opt.xAxis) delete o.xAxis;
    if (!opt.yAxis) delete o.yAxis;
    return o;
  }

  // Raw escape hatch: Dash.echarts("#el", option) — themed, responsive, dark-mode aware.
  function echartsRender(target, optionOrFn) {
    var n = el(target);
    if (!window.echarts) { n.textContent = "Chart library missing"; return null; }
    var inst = window.echarts.init(n, null, { renderer: "svg" });
    var entry = { inst: inst, build: typeof optionOrFn === "function" ? optionOrFn : function () { return optionOrFn; } };
    inst.setOption(withAxes(entry.build()));
    charts.push(entry);
    return inst;
  }
  function rerenderAll() { charts.forEach(function (c) { c.inst.setOption(withAxes(c.build()), true); }); }
  var ro = new ResizeObserver(function () { charts.forEach(function (c) { c.inst.resize(); }); });
  window.addEventListener("load", function () { charts.forEach(function (c) { ro.observe(c.inst.getDom()); }); });
  window.addEventListener("resize", function () { charts.forEach(function (c) { c.inst.resize(); }); });

  function tipHtml(title, rows) {
    return '<div class="dk-tip"><div class="t">' + esc(title) + "</div>" + rows.map(function (r) { return '<div class="r"><span><i class="sw" style="background:' + r.color + '"></i>' + esc(r.name) + '</span><span class="v">' + esc(r.value) + "</span></div>"; }).join("") + "</div>";
  }

  // card with chart/table toggle
  function chartCard(target, o, buildOption, tableCols) {
    var rows = Array.isArray(o.data) ? o.data : data(o.data);
    var c = card(target, { title: o.title, subtitle: o.subtitle, note: o.note, height: o.height, toggle: true });
    if (!rows.length) { empty(c.body, o.emptyMessage); return null; }
    var tog = h("div", "dk-toggle");
    tog.innerHTML = '<button aria-pressed="true">Chart</button><button aria-pressed="false">Table</button>';
    c.head.appendChild(tog);
    var chartBox = h("div"); chartBox.style.cssText = "position:absolute;inset:0";
    c.body.appendChild(chartBox);
    var tableBox = h("div", "dk-table-wrap"); tableBox.style.display = "none";
    c.root.appendChild(tableBox);
    var inst = echartsRender(chartBox, function () { return buildOption(rows); });
    table(tableBox, { data: rows, columns: tableCols, bare: true });
    var b = tog.querySelectorAll("button");
    b[0].onclick = function () { b[0].setAttribute("aria-pressed", "true"); b[1].setAttribute("aria-pressed", "false"); c.body.style.display = ""; tableBox.style.display = "none"; inst && inst.resize(); };
    b[1].onclick = function () { b[1].setAttribute("aria-pressed", "true"); b[0].setAttribute("aria-pressed", "false"); c.body.style.display = "none"; tableBox.style.display = ""; };
    return inst;
  }

  function allIntegers(rows, keys) {
    for (var i = 0; i < rows.length; i++) for (var k = 0; k < keys.length; k++) { var v = rows[i][keys[k]]; if (v != null && v !== "" && !Number.isInteger(Number(v))) return false; }
    return true;
  }
  function seriesNames(o) { return (o.series || [o.y]).map(function (s) { return typeof s === "string" ? { key: s, name: o.labels && o.labels[s] ? o.labels[s] : s } : s; }); }

  // Dash.bar("#el", { title, subtitle, data, x, y | series:[...], horizontal, sort:"desc"|"asc"|false, format, highlight, stacked, limit })
  function bar(target, o) {
    var series = seriesNames(o);
    var single = series.length === 1;
    return chartCard(target, o, function (rows0) {
      var rows = rows0.slice();
      var sortKey = series[0].key;
      if (o.sort !== false && (o.sort || o.horizontal)) rows.sort(function (a, b) { return o.sort === "asc" ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]; });
      if (o.limit) rows = rows.slice(0, o.limit);
      if (o.horizontal) rows.reverse();
      var cats = rows.map(function (r) { return o.xFormat ? format(r[o.x], o.xFormat) : r[o.x]; });
      var pal = palette();
      var catAxis = { type: "category", data: cats, axisLabel: { color: css("--dk-muted"), fontSize: 11.5, width: o.horizontal ? 120 : undefined, overflow: "truncate", hideOverlap: true } };
      var ints = allIntegers(rows, series.map(function (s) { return s.key; }));
      var valAxis = { type: "value", minInterval: ints ? 1 : undefined, axisLabel: { formatter: function (v) { return format(v, o.axisFormat || (o.format === "currency" ? "currency-compact" : o.format === "percent" ? "percent" : "compact")); } } };
      return {
        legend: single ? { show: false } : { data: series.map(function (s) { return s.name; }) },
        grid: { top: single ? 12 : 34, right: o.horizontal && o.labels === true ? 48 : 16 },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow", shadowStyle: { color: css("--dk-grid") } }, formatter: function (ps) { return tipHtml(ps[0].name, ps.map(function (p) { return { name: p.seriesName, value: format(p.value, o.format), color: p.color }; })); } },
        xAxis: o.horizontal ? valAxis : catAxis,
        yAxis: o.horizontal ? catAxis : valAxis,
        series: series.map(function (s, i) {
          return {
            name: s.name, type: "bar", stack: o.stacked ? "total" : undefined, barMaxWidth: o.horizontal ? 18 : 34, barCategoryGap: "38%",
            data: rows.map(function (r) {
              var c = single && o.highlight != null ? (String(r[o.x]) === String(o.highlight) ? pal[0] : css("--dk-grid").replace(/0\.07\)/, "0.25)")) : pal[i % pal.length];
              return { value: r[s.key], itemStyle: { color: single && o.highlight == null ? pal[0] : c, borderRadius: o.stacked ? 0 : o.horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0] } };
            }),
            label: o.labels === true ? { show: true, position: o.horizontal ? "right" : "top", color: css("--dk-ink-2"), fontSize: 11, formatter: function (p) { return format(p.value, o.format); } } : undefined,
            emphasis: { focus: "series" },
          };
        }),
      };
    }, [{ key: o.x, label: o.xLabel || o.x, format: o.xFormat }].concat(series.map(function (s) { return { key: s.key, label: s.name, format: o.format, bar: single }; })));
  }

  // Dash.line("#el", { title, data, x, y | series:[...], area, format, xFormat, smooth, markLatest })
  function line(target, o) {
    var series = seriesNames(o);
    return chartCard(target, o, function (rows) {
      var pal = palette();
      var single = series.length === 1;
      var cats = rows.map(function (r) { return o.xFormat ? format(r[o.x], o.xFormat) : r[o.x]; });
      return {
        legend: single ? { show: false } : { data: series.map(function (s) { return s.name; }) },
        grid: { top: single ? 12 : 34, right: 26 },
        tooltip: { formatter: function (ps) { return tipHtml(ps[0].name, ps.map(function (p) { return { name: p.seriesName, value: format(p.value, o.format), color: p.color }; })); } },
        xAxis: { type: "category", data: cats, boundaryGap: false, axisLabel: { hideOverlap: true, showMinLabel: true, showMaxLabel: true, alignMinLabel: "left", alignMaxLabel: "right", margin: 10 } },
        yAxis: { type: "value", scale: !!o.scale, minInterval: allIntegers(rows, series.map(function (s) { return s.key; })) ? 1 : undefined, axisLabel: { formatter: function (v) { return format(v, o.axisFormat || (o.format === "currency" ? "currency-compact" : o.format === "percent" ? "percent" : "compact")); } } },
        series: series.map(function (s, i) {
          var col = pal[i % pal.length];
          return {
            name: s.name, type: "line", smooth: o.smooth !== false ? 0.25 : false, showSymbol: rows.length <= 14, symbolSize: 7, symbol: "circle",
            lineStyle: { width: 2, color: col }, itemStyle: { color: col, borderColor: css("--dk-surface"), borderWidth: 2 },
            areaStyle: o.area !== false && (single || o.area) ? { color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: col + "38" }, { offset: 1, color: col + "00" }]) } : undefined,
            data: rows.map(function (r) { return r[s.key]; }),
            markPoint: o.markMax ? { symbol: "circle", symbolSize: 1, label: { show: true, position: "top", color: css("--dk-ink-2"), fontSize: 11, formatter: function (p) { return format(p.value, o.format); } }, data: [{ type: "max" }] } : undefined,
          };
        }),
      };
    }, [{ key: o.x, label: o.xLabel || o.x, format: o.xFormat }].concat(series.map(function (s) { return { key: s.key, label: s.name, format: o.format }; })));
  }

  // Dash.donut("#el", { title, data, label, value, format, centerLabel }) — part-to-whole, ≤6 slices (rest folded into "Other")
  function donut(target, o) {
    return chartCard(target, o, function (rows0) {
      var rows = rows0.slice().sort(function (a, b) { return b[o.value] - a[o.value]; });
      if (rows.length > 6) { var rest = rows.slice(5).reduce(function (s, r) { return s + Number(r[o.value] || 0); }, 0); rows = rows.slice(0, 5); var other = {}; other[o.label] = "Other"; other[o.value] = rest; rows.push(other); }
      var total = rows.reduce(function (s, r) { return s + Number(r[o.value] || 0); }, 0);
      return {
        tooltip: { trigger: "item", formatter: function (p) { return tipHtml(p.name, [{ name: fmt.percent(p.percent / 100), value: format(p.value, o.format), color: p.color }]); } },
        legend: { orient: "vertical", right: 0, top: "middle", formatter: function (name) { var r = rows.find(function (x) { return x[o.label] === name; }); return name + "  " + (r ? fmt.percent(r[o.value] / (total || 1), 0) : ""); } },
        graphic: [{ type: "text", left: "28%", top: "center", style: { text: format(total, o.format) + "\n" + (o.centerLabel || "Total"), textAlign: "center", fill: css("--dk-ink"), fontSize: 16, fontWeight: 700, lineHeight: 22, fontFamily: css("--dk-font") } }],
        series: [{ type: "pie", radius: ["58%", "80%"], center: ["32%", "50%"], padAngle: 2, itemStyle: { borderRadius: 6, borderColor: css("--dk-surface"), borderWidth: 2 }, label: { show: false }, data: rows.map(function (r) { return { name: r[o.label], value: r[o.value] }; }) }],
      };
    }, [{ key: o.label, label: o.label }, { key: o.value, label: o.valueLabel || o.value, format: o.format, bar: true }]);
  }

  // Dash.heatmap("#el", { title, data, x, y, value, format }) — single-hue sequential
  function heatmap(target, o) {
    return chartCard(target, o, function (rows) {
      var xs = Array.from(new Set(rows.map(function (r) { return r[o.x]; })));
      var ys = Array.from(new Set(rows.map(function (r) { return r[o.y]; })));
      var vals = rows.map(function (r) { return Number(r[o.value]) || 0; });
      return {
        tooltip: { trigger: "item", formatter: function (p) { return tipHtml(ys[p.value[1]] + " · " + xs[p.value[0]], [{ name: o.valueLabel || o.value, value: format(p.value[2], o.format), color: css("--dk-accent") }]); } },
        grid: { top: 8, bottom: 48 },
        xAxis: { type: "category", data: xs, splitArea: { show: false } },
        yAxis: { type: "category", data: ys, splitLine: { show: false } },
        visualMap: { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), calculable: false, text: [format(Math.max.apply(null, vals), o.format), format(Math.min.apply(null, vals), o.format)], textGap: 8, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, itemWidth: 10, textStyle: { color: css("--dk-muted"), fontSize: 11 }, inRange: { color: [css("--dk-accent-soft"), css("--dk-accent")] } },
        series: [{ type: "heatmap", data: rows.map(function (r) { return [xs.indexOf(r[o.x]), ys.indexOf(r[o.y]), r[o.value]]; }), itemStyle: { borderRadius: 4, borderColor: css("--dk-surface"), borderWidth: 2 } }],
      };
    }, [{ key: o.y, label: o.y }, { key: o.x, label: o.x }, { key: o.value, label: o.valueLabel || o.value, format: o.format, bar: true }]);
  }

  // ---------- table ----------
  // Dash.table("#el", { title, data, columns:[{key,label,format,bar:true,align}], limit, sortBy, sortDir })
  function table(target, o) {
    var rows = (Array.isArray(o.data) ? o.data : data(o.data)).slice();
    var cols = o.columns || (rows[0] ? Object.keys(rows[0]).map(function (k) { return { key: k, label: k }; }) : []);
    var host;
    if (o.bare) host = el(target);
    else { var c = card(target, { title: o.title, subtitle: o.subtitle, note: o.note, bodyClass: "dk-table-wrap" }); host = c.body; }
    if (!rows.length) { empty(host, o.emptyMessage); return; }
    var sortKey = o.sortBy, dir = o.sortDir || "desc";
    // Short tables show every row; only long ones scroll inside the card.
    var shown = o.limit ? Math.min(rows.length, o.limit) : rows.length;
    if (shown <= 20) host.style.maxHeight = "none";
    var maxes = {};
    cols.forEach(function (c) { if (c.bar) maxes[c.key] = Math.max.apply(null, rows.map(function (r) { return Math.abs(Number(r[c.key]) || 0); })) || 1; });
    function isNum(c) { return c.align === "right" || c.bar || typeof rows[0][c.key] === "number"; }
    function render() {
      var rs = rows.slice();
      if (sortKey) rs.sort(function (a, b) { var x = a[sortKey], y = b[sortKey]; var r = typeof x === "number" ? x - y : String(x).localeCompare(String(y)); return dir === "asc" ? r : -r; });
      if (o.limit) rs = rs.slice(0, o.limit);
      host.innerHTML = '<table class="dk-table"><thead><tr>' + cols.map(function (c) {
        return '<th data-k="' + esc(c.key) + '" class="' + (isNum(c) ? "num" : "") + '"' + (sortKey === c.key ? ' aria-sort="' + (dir === "asc" ? "ascending" : "descending") + '"' : "") + ">" + esc(c.label || c.key) + "</th>";
      }).join("") + "</tr></thead><tbody>" + rs.map(function (r) {
        return "<tr>" + cols.map(function (c) {
          var v = format(r[c.key], c.format);
          if (c.bar) {
            var w = Math.round((Math.abs(Number(r[c.key]) || 0) / maxes[c.key]) * 64);
            return '<td class="num"><div class="dk-cellbar"><span>' + esc(v) + '</span><i style="width:' + w + 'px"></i></div></td>';
          }
          return '<td class="' + (isNum(c) ? "num" : "") + '">' + esc(v) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
      host.querySelectorAll("th").forEach(function (th) {
        th.onclick = function () { var k = th.getAttribute("data-k"); if (sortKey === k) dir = dir === "asc" ? "desc" : "asc"; else { sortKey = k; dir = "desc"; } render(); };
      });
    }
    render();
  }

  // ---------- ranked list ----------
  // Dash.list("#el", { title, data, label, sub, value, format, limit })
  function list(target, o) {
    var rows = (Array.isArray(o.data) ? o.data : data(o.data)).slice(0, o.limit || 8);
    var c = card(target, { title: o.title, subtitle: o.subtitle, note: o.note, bodyClass: "dk-list-wrap" });
    if (!rows.length) { empty(c.body, o.emptyMessage); return; }
    c.body.innerHTML = '<ol class="dk-list">' + rows.map(function (r, i) {
      return '<li><span class="rank">' + (i + 1) + '</span><div class="grow"><div class="main">' + esc(r[o.label]) + "</div>" + (o.sub ? '<div class="sub">' + esc(format(r[o.sub], o.subFormat)) + "</div>" : "") + '</div><span class="val">' + esc(format(r[o.value], o.format)) + "</span></li>";
    }).join("") + "</ol>";
  }

  // ---------- insight ----------
  // Dash.insight("#el", "Revenue is <strong>up 12%</strong> week over week, driven by Enterprise.")  (simple <strong> allowed)
  function insight(target, html) {
    var n = el(target);
    n.classList.add("dk-card", "dk-insight");
    var safe = esc(html).replace(/&lt;(\/?)strong&gt;/g, "<$1strong>");
    n.innerHTML = '<div class="dk-insight-dot">i</div><p>' + safe + "</p>";
  }

  // ---------- segmented filter ----------
  // Dash.segmented("#el", { options:[{value,label}], value, onChange })
  function segmented(target, o) {
    var n = el(target);
    n.className = "dk-seg";
    var cur = o.value;
    function render() {
      n.innerHTML = o.options.map(function (op) { return '<button aria-pressed="' + (op.value === cur) + '" data-v="' + esc(op.value) + '">' + esc(op.label) + "</button>"; }).join("");
      n.querySelectorAll("button").forEach(function (b) { b.onclick = function () { cur = b.getAttribute("data-v"); render(); o.onChange && o.onChange(cur); }; });
    }
    render();
    return { get value() { return cur; } };
  }

  function footer(target, text) {
    var n = el(target) || document.body.appendChild(h("footer"));
    n.className = "dk-footer";
    n.innerHTML = "<span>" + esc(text || "") + "</span><span>Built with MyDashie</span>";
  }

  // ---------- pages (tabs) ----------
  // Markup: <section class="dk-page" data-page="overview" data-title="Overview"><div class="dk-grid">…</div></section>
  // Build every chart first, then call Dash.pages() once at the end.
  var pageState = { ids: [], active: null };
  function showPage(id) {
    var pages = Array.prototype.slice.call(document.querySelectorAll(".dk-page"));
    if (!pages.some(function (p) { return p.getAttribute("data-page") === id; })) id = pageState.ids[0];
    pages.forEach(function (p) { p.hidden = p.getAttribute("data-page") !== id; });
    document.querySelectorAll(".dk-tabs button").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-page") === id)); });
    pageState.active = id;
    if (history.replaceState) history.replaceState(null, "", "#" + id);
    post({ type: "dash-state", page: id, scrollY: window.scrollY, cards: cardIds() });
    requestAnimationFrame(function () { charts.forEach(function (c) { c.inst.resize(); }); });
  }
  function pages(target) {
    var list = Array.prototype.slice.call(document.querySelectorAll(".dk-page"));
    pageState.ids = list.map(function (p, i) { if (!p.getAttribute("data-page")) p.setAttribute("data-page", "page-" + (i + 1)); return p.getAttribute("data-page"); });
    if (list.length < 2) return;
    var bar = el(target) || (function () { var n = h("nav"); list[0].parentNode.insertBefore(n, list[0]); return n; })();
    bar.className = "dk-tabs";
    bar.innerHTML = '<div class="dk-tabs-pill" role="tablist">' + list.map(function (p) { var id = p.getAttribute("data-page"); return '<button role="tab" data-page="' + esc(id) + '">' + esc(p.getAttribute("data-title") || id) + "</button>"; }).join("") + "</div>";
    bar.querySelectorAll("button").forEach(function (b) { b.onclick = function () { showPage(b.getAttribute("data-page")); window.scrollTo({ top: 0 }); }; });
    bar.addEventListener("keydown", function (e) {
      var i = pageState.ids.indexOf(pageState.active);
      if (e.key === "ArrowRight") showPage(pageState.ids[(i + 1) % pageState.ids.length]);
      if (e.key === "ArrowLeft") showPage(pageState.ids[(i - 1 + pageState.ids.length) % pageState.ids.length]);
    });
    var fromHash = location.hash.slice(1);
    showPage(pageState.ids.indexOf(fromHash) >= 0 ? fromHash : pageState.ids[0]);
  }

  // ---------- host handshake (MyDashie viewer) ----------
  function cardIds() {
    return Array.prototype.map.call(document.querySelectorAll(".dk-card"), function (n, i) { var pg = n.closest(".dk-page"); return (pg ? pg.getAttribute("data-page") + "/" : "") + (n.id || "card-" + i); });
  }
  function post(msg) { try { if (window.parent !== window) window.parent.postMessage(msg, "*"); } catch (e) {} }
  window.addEventListener("load", function () { post({ type: "dash-ready", staged: staged, page: pageState.active, cards: cardIds() }); });
  window.addEventListener("message", function (e) {
    var m = e.data || {};
    if (m.type === "dash-get-state") post({ type: "dash-state", page: pageState.active, scrollY: window.scrollY, cards: cardIds() });
    if (m.type === "dash-reveal") {
      if (m.page && pageState.ids.indexOf(m.page) >= 0) showPage(m.page);
      var prev = {}; (m.prevCards || []).forEach(function (id) { prev[id] = 1; });
      var ids = cardIds();
      document.querySelectorAll(".dk-card").forEach(function (n, i) { if (!prev[ids[i]]) n.classList.add("dk-new"); });
      if (m.scrollY) window.scrollTo(0, m.scrollY);
      requestAnimationFrame(function () { charts.forEach(function (c) { c.inst.resize(); }); });
    }
  });
  var scrollTimer;
  window.addEventListener("scroll", function () { clearTimeout(scrollTimer); scrollTimer = setTimeout(function () { post({ type: "dash-state", page: pageState.active, scrollY: window.scrollY, cards: cardIds() }); }, 150); }, { passive: true });

  window.Dash = {
    pages: pages, showPage: showPage, pageIds: function () { return pageState.ids.slice(); }, pageTitle: function (id) { var p = document.querySelector('.dk-page[data-page="' + id + '"]'); return p ? p.getAttribute("data-title") || id : id; },
    data: data, fmt: fmt, format: format,
    header: header, kpi: kpi, bar: bar, line: line, donut: donut, heatmap: heatmap, table: table, list: list,
    insight: insight, segmented: segmented, empty: empty, footer: footer, echarts: echartsRender,
    palette: palette, css: css, rerender: rerenderAll,
  };
})();
