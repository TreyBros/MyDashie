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
    number: function (v, d) { return v == null || isNaN(v) ? "\u2013" : Number(v).toLocaleString(locale, { maximumFractionDigits: d == null ? 0 : d, minimumFractionDigits: d == null ? 0 : d }); },
    compact: function (v) { return v == null || isNaN(v) ? "\u2013" : Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(v); },
    currency: function (v, cur, compact) {
      if (v == null || isNaN(v)) return "\u2013";
      return Intl.NumberFormat(locale, { style: "currency", currency: cur || "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : Math.abs(v) >= 1000 ? 0 : 2 }).format(v);
    },
    percent: function (v, d) { return v == null || isNaN(v) ? "\u2013" : (Number(v) * 100).toFixed(d == null ? 1 : d) + "%"; },
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
    return v == null ? "\u2013" : String(v);
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
  // The change badge shared by KPI, hero and stats: previous -> % change with good/bad tone, or a given change.
  function deltaHtml(o) {
    var value = Number(o.value);
    if (o.previous != null && !isNaN(o.previous) && Number(o.previous) !== 0) {
      var change = (value - Number(o.previous)) / Math.abs(Number(o.previous));
      var up = change > 0.0005, down = change < -0.0005;
      var goodWhen = o.goodWhen || "up";
      var tone = !up && !down ? "flat" : (up && goodWhen === "up") || (down && goodWhen === "down") ? "good" : "bad";
      var arrow = up ? '<svg viewBox="0 0 10 10"><path d="M5 1.5 9 7H1z" fill="currentColor"/></svg>' : down ? '<svg viewBox="0 0 10 10"><path d="M5 8.5 1 3h8z" fill="currentColor"/></svg>' : "";
      var word = up ? "Up" : down ? "Down" : "Flat";
      return '<span class="dk-delta ' + tone + '" title="' + word + " " + fmt.percent(Math.abs(change)) + '">' + arrow + '<span class="sr">' + (up || down ? fmt.percent(Math.abs(change)) : "0%") + "</span></span>";
    }
    if (o.change != null) {
      var c = Number(o.change);
      var t2 = c === 0 ? "flat" : (c > 0) === ((o.goodWhen || "up") === "up") ? "good" : "bad";
      return '<span class="dk-delta ' + t2 + '">' + (c > 0 ? "\u25b2 " : c < 0 ? "\u25bc " : "") + fmt.percent(Math.abs(c)) + "</span>";
    }
    return "";
  }
  function metaHtml(o) {
    var d = deltaHtml(o);
    return d || o.compareLabel || o.note ? '<div class="dk-kpi-meta">' + d + (d && o.compareLabel ? "<span>" + esc(o.compareLabel) + "</span>" : "") + (o.note ? "<span>" + esc(o.note) + "</span>" : "") + "</div>" : "";
  }
  function bigValue(o) { var v = Number(o.value); return esc(isNaN(v) ? String(o.value == null ? "\u2013" : o.value) : format(v, o.format)); }

  // Dash.kpi("#k1", { label, value, format, previous, compareLabel: "vs last week", goodWhen: "up"|"down", spark: [..], target, note, drill })
  function kpi(target, o) {
    var n = el(target);
    n.classList.add("dk-card", "dk-kpi");
    var value = Number(o.value);
    var color = css("--dk-accent");
    var targetHtml = "";
    if (o.target != null && !isNaN(o.target) && Number(o.target) > 0) {
      var pct = Math.max(0, Math.min(1, value / Number(o.target)));
      targetHtml = '<div class="dk-target"><div class="dk-target-track"><div class="dk-target-fill" style="width:' + (pct * 100).toFixed(1) + '%"></div></div><div class="dk-target-label"><span>' + fmt.percent(pct, 0) + ' of target</span><span>Target ' + esc(format(o.target, o.format)) + "</span></div></div>";
    }
    n.innerHTML =
      '<div class="dk-kpi-label">' + esc(o.label) + "</div>" +
      '<div class="dk-kpi-row"><div class="dk-kpi-value">' + bigValue(o) + "</div>" + sparkSvg(o.spark, color) + "</div>" +
      metaHtml(o) + targetHtml;
    if (o.drill && typeof o.drill === "object") clickable(n, function () { drillOpen(Object.assign({ title: o.label }, o.drill), {}, []); }, o.drill);
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

  // Raw escape hatch: Dash.echarts("#el", option) \u2014 themed, responsive, dark-mode aware.
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

  // card with chart/table toggle. buildOption(rows, ctx) stores the rows it actually drew (sorted, limited)
  // in ctx.rows, so a click can find the row behind a bar, point, slice or cell. keys = the columns that
  // identify a clicked item, used to match rows of a drill dataset.
  function chartCard(target, o, buildOption, tableCols, keys, clickKind) {
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
    var ctx = { rows: rows };
    var inst = echartsRender(chartBox, function () {
      var opt = buildOption(rows, ctx);
      if (o.drill && opt.tooltip && opt.tooltip.formatter) { var f = opt.tooltip.formatter; opt.tooltip.formatter = function (p) { return f(p) + '<div class="dk-tip-hint">Click for details</div>'; }; }
      return opt;
    });
    if (inst && o.drill) { c.root.classList.add("dk-drillable"); wireChartDrill(inst, o.drill, ctx, keys || [], clickKind); }
    table(tableBox, { data: rows, columns: tableCols, bare: true, drill: o.drill, drillKeys: keys });
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
    return chartCard(target, o, function (rows0, ctx) {
      var rows = rows0.slice();
      var sortKey = series[0].key;
      if (o.sort !== false && (o.sort || o.horizontal)) rows.sort(function (a, b) { return o.sort === "asc" ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey]; });
      if (o.limit) rows = rows.slice(0, o.limit);
      if (o.horizontal) rows.reverse();
      ctx.rows = rows;
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
    }, [{ key: o.x, label: o.xLabel || o.x, format: o.xFormat }].concat(series.map(function (s) { return { key: s.key, label: s.name, format: o.format, bar: single }; })), [o.x], "axis");
  }

  // Dash.line("#el", { title, data, x, y | series:[...], area, format, xFormat, smooth, markLatest })
  function line(target, o) {
    var series = seriesNames(o);
    return chartCard(target, o, function (rows, ctx) {
      ctx.rows = rows;
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
    }, [{ key: o.x, label: o.xLabel || o.x, format: o.xFormat }].concat(series.map(function (s) { return { key: s.key, label: s.name, format: o.format }; })), [o.x], "axis");
  }

  // Dash.donut("#el", { title, data, label, value, format, centerLabel }) \u2014 part-to-whole, \u22646 slices (rest folded into "Other")
  function donut(target, o) {
    return chartCard(target, o, function (rows0, ctx) {
      var rows = rows0.slice().sort(function (a, b) { return b[o.value] - a[o.value]; });
      if (rows.length > 6) { var rest = rows.slice(5).reduce(function (s, r) { return s + Number(r[o.value] || 0); }, 0); rows = rows.slice(0, 5); var other = { __other: true }; other[o.label] = "Other"; other[o.value] = rest; rows.push(other); }
      ctx.rows = rows;
      var total = rows.reduce(function (s, r) { return s + Number(r[o.value] || 0); }, 0);
      return {
        tooltip: { trigger: "item", formatter: function (p) { return tipHtml(p.name, [{ name: fmt.percent(p.percent / 100), value: format(p.value, o.format), color: p.color }]); } },
        legend: { orient: "vertical", right: 0, top: "middle", formatter: function (name) { var r = rows.find(function (x) { return x[o.label] === name; }); return name + "  " + (r ? fmt.percent(r[o.value] / (total || 1), 0) : ""); } },
        graphic: [{ type: "text", left: "28%", top: "center", style: { text: format(total, o.format) + "\n" + (o.centerLabel || "Total"), textAlign: "center", fill: css("--dk-ink"), fontSize: 16, fontWeight: 700, lineHeight: 22, fontFamily: css("--dk-font") } }],
        series: [{ type: "pie", radius: ["58%", "80%"], center: ["32%", "50%"], padAngle: 2, itemStyle: { borderRadius: 6, borderColor: css("--dk-surface"), borderWidth: 2 }, label: { show: false }, data: rows.map(function (r) { return { name: r[o.label], value: r[o.value] }; }) }],
      };
    }, [{ key: o.label, label: o.label }, { key: o.value, label: o.valueLabel || o.value, format: o.format, bar: true }], [o.label], "item");
  }

  // Dash.heatmap("#el", { title, data, x, y, value, format }) \u2014 single-hue sequential
  function heatmap(target, o) {
    return chartCard(target, o, function (rows, ctx) {
      ctx.rows = rows;
      var xs = Array.from(new Set(rows.map(function (r) { return r[o.x]; })));
      var ys = Array.from(new Set(rows.map(function (r) { return r[o.y]; })));
      var vals = rows.map(function (r) { return Number(r[o.value]) || 0; });
      return {
        tooltip: { trigger: "item", formatter: function (p) { return tipHtml(ys[p.value[1]] + " \u00b7 " + xs[p.value[0]], [{ name: o.valueLabel || o.value, value: format(p.value[2], o.format), color: css("--dk-accent") }]); } },
        grid: { top: 8, bottom: 48 },
        xAxis: { type: "category", data: xs, splitArea: { show: false } },
        yAxis: { type: "category", data: ys, splitLine: { show: false } },
        visualMap: { min: Math.min.apply(null, vals), max: Math.max.apply(null, vals), calculable: false, text: [format(Math.max.apply(null, vals), o.format), format(Math.min.apply(null, vals), o.format)], textGap: 8, orient: "horizontal", left: "center", bottom: 0, itemHeight: 120, itemWidth: 10, textStyle: { color: css("--dk-muted"), fontSize: 11 }, inRange: { color: [css("--dk-accent-soft"), css("--dk-accent")] } },
        series: [{ type: "heatmap", data: rows.map(function (r) { return [xs.indexOf(r[o.x]), ys.indexOf(r[o.y]), r[o.value]]; }), itemStyle: { borderRadius: 4, borderColor: css("--dk-surface"), borderWidth: 2 } }],
      };
    }, [{ key: o.y, label: o.y }, { key: o.x, label: o.x }, { key: o.value, label: o.valueLabel || o.value, format: o.format, bar: true }], [o.x, o.y], "item");
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
    if (o.drill && !o.bare) { host.parentNode.classList.add("dk-drillable"); checkDrill(o.drill); }
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
        return "<tr" + (o.drill ? ' class="dk-row-drill" tabindex="0"' : "") + ">" + cols.map(function (c) {
          var v = format(r[c.key], c.format);
          if (c.bar) {
            var w = Math.round((Math.abs(Number(r[c.key]) || 0) / maxes[c.key]) * 64);
            return '<td class="num"><div class="dk-cellbar"><span>' + esc(v) + '</span><i style="width:' + w + 'px"></i></div></td>';
          }
          if (c.link && /^https?:\/\//.test(String(r[c.link] || ""))) return '<td><a class="dk-link" href="' + esc(r[c.link]) + '" target="_blank" rel="noopener">' + esc(v) + "</a></td>";
          return '<td class="' + (isNum(c) ? "num" : "") + '">' + esc(v) + "</td>";
        }).join("") + "</tr>";
      }).join("") + "</tbody></table>";
      host.querySelectorAll("th").forEach(function (th) {
        th.onclick = function () { var k = th.getAttribute("data-k"); if (sortKey === k) dir = dir === "asc" ? "desc" : "asc"; else { sortKey = k; dir = "desc"; } render(); };
      });
      if (o.drill) host.querySelectorAll("tbody tr").forEach(function (tr, i) { clickable(tr, function () { drillOpen(o.drill, rs[i], o.drillKeys || (o.drill.by ? null : [cols[0] && cols[0].key])); }); });
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
      return '<li' + (o.drill ? ' class="dk-row-drill" tabindex="0"' : "") + '><span class="rank">' + (i + 1) + '</span><div class="grow"><div class="main">' + esc(r[o.label]) + "</div>" + (o.sub ? '<div class="sub">' + esc(format(r[o.sub], o.subFormat)) + "</div>" : "") + '</div><span class="val">' + esc(format(r[o.value], o.format)) + "</span></li>";
    }).join("") + "</ol>";
    if (o.drill) { c.root.classList.add("dk-drillable"); checkDrill(o.drill); c.body.querySelectorAll("li").forEach(function (li, i) { clickable(li, function () { drillOpen(o.drill, rows[i], [o.label]); }); }); }
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
  // Markup: <section class="dk-page" data-page="overview" data-title="Overview"><div class="dk-grid">\u2026</div></section>
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

  // ---------- looks + accents ----------
  // Dash.theme({ look, accent }) \u2014 call first. Looks change the page's character; accents recolor it.
  var LOOKS = ["soft", "editorial", "bold", "minimal", "dense"];
  var ACCENTS = ["violet", "ocean", "mint", "tangerine", "rose", "gold"];
  function theme(o) {
    o = o || {};
    if (o.look) { if (LOOKS.indexOf(o.look) < 0) console.error("Dash.theme: unknown look \"" + o.look + "\". Use one of " + LOOKS.join(", ")); else root.setAttribute("data-look", o.look); }
    if (o.accent) { if (ACCENTS.indexOf(o.accent) < 0) console.error("Dash.theme: unknown accent \"" + o.accent + "\". Use one of " + ACCENTS.join(", ")); else root.setAttribute("data-accent", o.accent); }
    rerenderAll();
  }

  // ---------- drill-down drawer ----------
  // Any card can open details in place, with no model and no network: drill:true shows the clicked row's
  // own fields; drill:{ data, by, columns, title, subtitle, sum, format, fields } lists the matching rows of a
  // detail dataset (by: "col" when both datasets share the column, or { detailCol: "cardCol" }). Rows inside
  // the drawer open their own fields, with Back.
  var URL_KEYS = ["url", "link", "href", "web_url", "webViewLink", "html_url", "permalink", "webLink"];
  var TITLE_KEYS = ["title", "name", "subject", "label", "summary"];
  function isUrl(v) { return typeof v === "string" && /^https?:\/\//.test(v); }
  function isImage(k, v) { return isUrl(v) && (/\.(png|jpe?g|webp|gif)(\?|$)/i.test(v) || /thumb|image|avatar|photo|picture/i.test(k)); }
  function rowUrl(r, key) { if (key && isUrl(r[key])) return r[key]; for (var i = 0; i < URL_KEYS.length; i++) if (isUrl(r[URL_KEYS[i]])) return r[URL_KEYS[i]]; return null; }
  function fill(tpl, r) { return String(tpl).replace(/\{(\w+)\}/g, function (_, k) { return r[k] == null ? "" : r[k]; }); }
  function humanKey(k) { return String(k).replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, function (c) { return c.toUpperCase(); }); }
  function autoFormat(v) {
    if (v == null || v === "") return "\u2013";
    if (typeof v === "boolean") return v ? "Yes" : "No";
    if (typeof v === "number") return Number.isInteger(v) ? fmt.number(v) : fmt.number(v, 2);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return fmt.datetime(v);
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmt.date(v, { month: "short", day: "numeric", year: "numeric" });
    if (Array.isArray(v)) return v.every(function (x) { return x == null || typeof x !== "object"; }) ? v.join(", ") : v.length + " items";
    if (typeof v === "object") return "\u2013";
    return String(v);
  }
  function pairsOf(spec, keys) {
    var by = spec.by || keys || [];
    if (typeof by === "string") return [[by, by]];
    if (Array.isArray(by)) return by.filter(Boolean).map(function (k) { return [k, k]; });
    return Object.keys(by).map(function (k) { return [k, by[k]]; });
  }
  // Broken drills fail loudly at render so the builder's QA sees them, not the user's click.
  function checkDrill(spec, keys) {
    if (!spec || spec === true || !spec.data) return;
    var all = (window.DASH && window.DASH.data) || {};
    if (!(spec.data in all)) { console.error("Dash drill: dataset \"" + spec.data + "\" is not published"); return; }
    var first = all[spec.data][0];
    if (first) pairsOf(spec, keys).forEach(function (p) { if (!(p[0] in first)) console.error("Dash drill: dataset \"" + spec.data + "\" has no column \"" + p[0] + "\""); });
  }
  function clickable(node, fn, spec) {
    if (spec) checkDrill(spec);
    node.classList.add("dk-clickable");
    if (!node.hasAttribute("tabindex")) node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.addEventListener("click", function (e) { if (e.target.closest && e.target.closest("a")) return; fn(); });
    node.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); } });
  }
  function wireChartDrill(inst, spec, ctx, keys, kind) {
    checkDrill(spec, keys);
    if (kind === "axis") {
      // Category charts: a click anywhere in a bar's or point's column opens it, not only on the mark.
      inst.getZr().on("click", function (e) {
        if (!inst.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY])) return;
        var opt = inst.getOption();
        var horiz = opt.yAxis && opt.yAxis[0] && opt.yAxis[0].type === "category";
        var pt = inst.convertFromPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]);
        var r = ctx.rows[Math.round(horiz ? pt[1] : pt[0])];
        if (r) drillOpen(spec, r, keys);
      });
      inst.getZr().on("mousemove", function (e) { inst.getZr().setCursorStyle(inst.containPixel({ gridIndex: 0 }, [e.offsetX, e.offsetY]) ? "pointer" : "default"); });
    } else {
      inst.on("click", function (p) { var r = ctx.rows[p.dataIndex]; if (r && !r.__other) drillOpen(spec, r, keys); });
    }
  }
  function drillOpen(spec, row, keys) {
    if (spec && spec !== true && spec.data) openMatches(spec, row, keys);
    else openRow(row, spec === true ? {} : spec || {});
  }
  function openMatches(spec, row, keys) {
    var pairs = pairsOf(spec, keys);
    var rows = data(spec.data).filter(function (d) { return pairs.every(function (p) { return String(d[p[0]]) === String(row[p[1]]); }); });
    var label = pairs.map(function (p) { var v = row[p[1]]; return v == null ? "" : String(v); }).filter(Boolean).join(" \u00b7 ");
    var summary = rows.length.toLocaleString() + (rows.length === 1 ? " record" : " records");
    if (spec.sum) summary += " \u00b7 " + format(rows.reduce(function (s, r) { return s + (Number(r[spec.sum]) || 0); }, 0), spec.format) + " total";
    var cols = spec.columns || (rows[0] ? Object.keys(rows[0]).filter(function (k) { var v = rows[0][k]; return k.charAt(0) !== "_" && !isUrl(v) && (v == null || typeof v !== "object"); }).slice(0, 5).map(function (k) { return { key: k, label: humanKey(k) }; }) : []);
    pushView({ title: spec.title ? fill(spec.title, row) : label || "Details", subtitle: spec.subtitle ? fill(spec.subtitle, row) : summary, rows: rows, columns: cols, sortBy: spec.sortBy || spec.sum, rowSpec: { fields: spec.fields, url: spec.url } });
  }
  function openRow(row, spec) {
    var keys = Object.keys(row).filter(function (k) { return k.charAt(0) !== "_"; });
    var titleKey = spec.titleKey || TITLE_KEYS.filter(function (k) { return typeof row[k] === "string"; })[0] || keys.filter(function (k) { return typeof row[k] === "string" && !isUrl(row[k]); })[0];
    var image = keys.filter(function (k) { return isImage(k, row[k]); })[0];
    var fields = (spec.fields || keys.filter(function (k) { return k !== titleKey && k !== image && !isUrl(row[k]) && !(row[k] && typeof row[k] === "object" && !Array.isArray(row[k])); }))
      .map(function (f) { var c = typeof f === "string" ? { key: f } : f; return [c.label || humanKey(c.key), c.format ? format(row[c.key], c.format) : autoFormat(row[c.key])]; });
    pushView({ title: spec.title ? fill(spec.title, row) : titleKey ? String(row[titleKey]) : "Details", subtitle: spec.subtitle ? fill(spec.subtitle, row) : "", url: rowUrl(row, spec.url), image: image ? row[image] : null, fields: fields });
  }

  var drawer = null, stack = [], lastFocus = null;
  function ensureDrawer() {
    if (drawer) return drawer;
    var scrim = h("div", "dk-drawer-scrim");
    var panel = h("aside", "dk-drawer");
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.tabIndex = -1;
    scrim.onclick = closeDrawer;
    document.body.appendChild(scrim); document.body.appendChild(panel);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape" || !stack.length) return;
      e.stopPropagation();
      if (stack.length > 1) { stack.pop(); renderDrawer(); } else closeDrawer();
    });
    drawer = { scrim: scrim, panel: panel };
    return drawer;
  }
  function pushView(v) {
    var d = ensureDrawer();
    if (!stack.length) lastFocus = document.activeElement;
    stack.push(v);
    renderDrawer();
    root.classList.add("dk-drawer-active");
    requestAnimationFrame(function () { if (!stack.length) return; d.scrim.classList.add("open"); d.panel.classList.add("open"); d.panel.focus({ preventScroll: true }); });
  }
  function closeDrawer() {
    if (!drawer) return;
    stack = [];
    drawer.scrim.classList.remove("open"); drawer.panel.classList.remove("open");
    root.classList.remove("dk-drawer-active");
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
  }
  function renderDrawer() {
    var v = stack[stack.length - 1], p = drawer.panel;
    p.setAttribute("aria-label", v.title);
    p.innerHTML =
      '<div class="dk-drawer-bar">' + (stack.length > 1 ? '<button class="dk-drawer-btn" data-act="back"><svg viewBox="0 0 16 16"><path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>Back</button>' : "<span></span>") +
      '<button class="dk-drawer-btn icon" data-act="close" aria-label="Close"><svg viewBox="0 0 16 16"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>' +
      '<div class="dk-drawer-body">' +
      (v.image ? '<img class="dk-drawer-img" src="' + esc(v.image) + '" alt="" referrerpolicy="no-referrer" onerror="this.remove()">' : "") +
      '<h2 class="dk-drawer-title">' + esc(v.title) + "</h2>" +
      (v.subtitle ? '<div class="dk-drawer-sub">' + esc(v.subtitle) + "</div>" : "") +
      (v.url ? '<a class="dk-drawer-open" href="' + esc(v.url) + '" target="_blank" rel="noopener">Open original<svg viewBox="0 0 16 16"><path d="M6 4h6v6M12 4l-7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></a>' : "") +
      (v.fields && v.fields.length ? '<dl class="dk-fields">' + v.fields.map(function (f) { return "<dt>" + esc(f[0]) + "</dt><dd>" + esc(f[1]) + "</dd>"; }).join("") + "</dl>" : "") +
      (v.rows ? '<div class="dk-drawer-table"></div>' + (v.rows.length > 200 ? '<div class="dk-card-foot">Showing 200 of ' + v.rows.length.toLocaleString() + "</div>" : "") : "") +
      "</div>";
    p.querySelector('[data-act="close"]').onclick = closeDrawer;
    var back = p.querySelector('[data-act="back"]');
    if (back) back.onclick = function () { stack.pop(); renderDrawer(); };
    if (v.rows) {
      var host = p.querySelector(".dk-drawer-table");
      if (!v.rows.length) empty(host, "Nothing matches", "No records for this item in the current data.");
      else table(host, { data: v.rows, columns: v.columns, bare: true, limit: 200, sortBy: v.sortBy, drill: { fields: v.rowSpec.fields, url: v.rowSpec.url, __row: true }, drillKeys: [] });
    }
  }

  // ---------- hero (one big number with its trend) ----------
  // Dash.hero("#el", { label, value, format, previous, compareLabel, goodWhen, note, data, x, y, xFormat, drill })
  function hero(target, o) {
    var n = el(target);
    n.classList.add("dk-card", "dk-hero");
    n.innerHTML = '<div class="dk-hero-top"><div class="dk-kpi-label">' + esc(o.label) + '</div><div class="dk-hero-value">' + bigValue(o) + "</div>" + metaHtml(o) + "</div>";
    var rows = o.data ? (Array.isArray(o.data) ? o.data : data(o.data)) : [];
    if (rows.length > 1 && o.x && o.y) {
      var box = h("div", "dk-hero-chart");
      n.appendChild(box);
      var span = h("div", "dk-hero-range", "<span>" + esc(format(rows[0][o.x], o.xFormat)) + "</span><span>" + esc(format(rows[rows.length - 1][o.x], o.xFormat)) + "</span>");
      n.appendChild(span);
      var ctx = { rows: rows };
      var inst = echartsRender(box, function () {
        var col = css("--dk-accent");
        return {
          grid: { left: 0, right: 0, top: 8, bottom: 0, containLabel: false },
          tooltip: { formatter: function (ps) { return tipHtml(format(rows[ps[0].dataIndex][o.x], o.xFormat || "date"), [{ name: o.label, value: format(ps[0].value, o.format), color: col }]) + (o.drill ? '<div class="dk-tip-hint">Click for details</div>' : ""); } },
          xAxis: { type: "category", show: false, boundaryGap: false, data: rows.map(function (r) { return r[o.x]; }) },
          yAxis: { type: "value", show: false, scale: true },
          series: [{ type: "line", smooth: 0.3, showSymbol: false, lineStyle: { width: 2.5, color: col }, itemStyle: { color: col }, areaStyle: { color: new window.echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: col + "40" }, { offset: 1, color: col + "00" }]) }, data: rows.map(function (r) { return r[o.y]; }) }],
        };
      });
      if (inst && o.drill) { n.classList.add("dk-drillable"); wireChartDrill(inst, o.drill, ctx, [o.x], "axis"); }
    }
    return n;
  }

  // ---------- stat strip (several small numbers in one card) ----------
  // Dash.stats("#el", { items:[{ label, value, format, previous, compareLabel, goodWhen, note }] })
  function stats(target, o) {
    var n = el(target);
    n.classList.add("dk-card", "dk-stats");
    n.innerHTML = (o.items || []).map(function (it) { return '<div class="dk-stat"><div class="dk-kpi-label">' + esc(it.label) + '</div><div class="dk-stat-value">' + bigValue(it) + "</div>" + metaHtml(it) + "</div>"; }).join("");
    return n;
  }

  // ---------- feed (cards for content: videos, emails, posts, docs, meetings) ----------
  // Dash.feed("#el", { title, subtitle, data, heading, text, meta, time, image, badge, value, format, url, limit, columns, drill })
  function feed(target, o) {
    var rows = (Array.isArray(o.data) ? o.data : data(o.data)).slice(0, o.limit || 6);
    var c = card(target, { title: o.title, subtitle: o.subtitle, note: o.note, bodyClass: "dk-feed" });
    if (!rows.length) { empty(c.body, o.emptyMessage); return; }
    if (o.columns) c.body.style.gridTemplateColumns = "repeat(" + o.columns + ", minmax(0, 1fr))";
    c.body.innerHTML = rows.map(function (r) {
      var img = o.image && /^https:\/\//.test(String(r[o.image] || "")) ? '<div class="dk-feed-img"><img src="' + esc(r[o.image]) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.parentNode.remove()"></div>' : "";
      var meta = [o.meta ? r[o.meta] : null, o.time && r[o.time] ? fmt.relative(r[o.time]) : null].filter(function (x) { return x != null && x !== ""; }).map(esc).join(" \u00b7 ");
      return '<article class="dk-feed-item">' + img + '<div class="dk-feed-text">' +
        (o.badge && r[o.badge] != null ? '<span class="dk-badge">' + esc(r[o.badge]) + "</span>" : "") +
        '<div class="dk-feed-head">' + esc(r[o.heading]) + "</div>" +
        (o.text && r[o.text] ? '<div class="dk-feed-body">' + esc(r[o.text]) + "</div>" : "") +
        (meta || o.value ? '<div class="dk-feed-meta"><span>' + meta + "</span>" + (o.value ? '<span class="val">' + esc(format(r[o.value], o.format)) + "</span>" : "") + "</div>" : "") +
        "</div></article>";
    }).join("");
    var spec = o.drill === false ? null : o.drill || { url: o.url };
    c.body.querySelectorAll(".dk-feed-item").forEach(function (item, i) {
      if (spec) clickable(item, function () { drillOpen(spec, rows[i], [o.heading]); }, spec);
      else if (o.url && isUrl(rows[i][o.url])) clickable(item, function () { window.open(rows[i][o.url], "_blank"); });
    });
  }

  // ---------- timeline (what happened, newest first, grouped by day) ----------
  // Dash.timeline("#el", { title, subtitle, data, time, heading, text, meta, badge, url, limit, drill })
  function timeline(target, o) {
    var rows = (Array.isArray(o.data) ? o.data : data(o.data)).slice().sort(function (a, b) { return new Date(b[o.time]) - new Date(a[o.time]); }).slice(0, o.limit || 12);
    var c = card(target, { title: o.title, subtitle: o.subtitle, note: o.note, bodyClass: "dk-tl-wrap" });
    if (!rows.length) { empty(c.body, o.emptyMessage); return; }
    var today = new Date(); today.setHours(0, 0, 0, 0);
    function dayLabel(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); var diff = Math.round((today - x) / 864e5); return diff === 0 ? "Today" : diff === 1 ? "Yesterday" : x.toLocaleDateString(locale, { weekday: "short", month: "short", day: "numeric" }); }
    var html = '<ol class="dk-tl">', last = null;
    rows.forEach(function (r, i) {
      var d = new Date(r[o.time]), lbl = isNaN(d) ? "" : dayLabel(d);
      if (lbl !== last) { html += '<li class="dk-tl-day">' + esc(lbl) + "</li>"; last = lbl; }
      var hasTime = typeof r[o.time] === "string" ? /T\d{2}:\d{2}/.test(r[o.time]) : true;
      html += '<li class="dk-tl-item" data-i="' + i + '"><span class="dk-tl-dot"></span><div class="grow">' +
        '<div class="dk-tl-head">' + (o.badge && r[o.badge] != null ? '<span class="dk-badge">' + esc(r[o.badge]) + "</span>" : "") + esc(r[o.heading]) + "</div>" +
        (o.text && r[o.text] ? '<div class="dk-tl-body">' + esc(r[o.text]) + "</div>" : "") +
        (o.meta && r[o.meta] ? '<div class="dk-tl-meta">' + esc(r[o.meta]) + "</div>" : "") +
        "</div>" + (hasTime && !isNaN(d) ? '<time class="dk-tl-time">' + esc(d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })) + "</time>" : "") + "</li>";
    });
    c.body.innerHTML = html + "</ol>";
    var spec = o.drill === false ? null : o.drill || { url: o.url };
    if (spec) c.body.querySelectorAll(".dk-tl-item").forEach(function (li) { var r = rows[Number(li.getAttribute("data-i"))]; clickable(li, function () { drillOpen(spec, r, [o.heading]); }, spec); });
  }

  // ---------- progress toward goals ----------
  // Dash.progress("#el", { title, subtitle, data, label, value, target: "col" | number, format, limit, drill })
  function progress(target, o) {
    var rows = (Array.isArray(o.data) ? o.data : data(o.data)).slice(0, o.limit || 8);
    var c = card(target, { title: o.title, subtitle: o.subtitle, note: o.note, bodyClass: "dk-progress" });
    if (!rows.length) { empty(c.body, o.emptyMessage); return; }
    var max = Math.max.apply(null, rows.map(function (r) { return Number(r[o.value]) || 0; })) || 1;
    c.body.innerHTML = rows.map(function (r) {
      var v = Number(r[o.value]) || 0;
      var t = typeof o.target === "number" ? o.target : o.target ? Number(r[o.target]) : null;
      var pct = t ? v / t : v / max;
      return '<div class="dk-prog' + (t && pct >= 1 ? " done" : "") + '"><div class="dk-prog-row"><span class="main">' + esc(r[o.label]) + '</span><span class="val">' + esc(format(v, o.format)) + (t ? '<span class="of"> / ' + esc(format(t, o.format)) + "</span>" : "") + "</span></div>" +
        '<div class="dk-target-track"><div class="dk-target-fill" style="width:' + (Math.min(1, Math.max(0, pct)) * 100).toFixed(1) + '%"></div></div></div>';
    }).join("");
    if (o.drill) { c.root.classList.add("dk-drillable"); c.body.querySelectorAll(".dk-prog").forEach(function (n, i) { clickable(n, function () { drillOpen(o.drill, rows[i], [o.label]); }, o.drill); }); }
  }

  // ---------- calendar heatmap (daily activity) ----------
  // Dash.calendar("#el", { title, subtitle, data, date, value, format, valueLabel, drill })
  function calendar(target, o) {
    o = Object.assign({ height: 190 }, o);
    return chartCard(target, o, function (rows0, ctx) {
      var rows = rows0.filter(function (r) { return r[o.date] != null; }).map(function (r) { var d = String(r[o.date]).slice(0, 10); return Object.assign({}, r, { __day: d }); }).sort(function (a, b) { return a.__day < b.__day ? -1 : 1; });
      var lastDay = rows.length ? rows[rows.length - 1].__day : new Date().toISOString().slice(0, 10);
      var start = new Date(lastDay); start.setDate(start.getDate() - 364);
      var first = rows.length && rows[0].__day > start.toISOString().slice(0, 10) ? rows[0].__day : start.toISOString().slice(0, 10);
      rows = rows.filter(function (r) { return r.__day >= first; });
      ctx.rows = rows;
      var vals = rows.map(function (r) { return Number(r[o.value]) || 0; });
      return {
        tooltip: { trigger: "item", formatter: function (p) { return tipHtml(fmt.date(p.value[0], { weekday: "short", month: "short", day: "numeric" }), [{ name: o.valueLabel || o.value, value: format(p.value[1], o.format), color: css("--dk-accent") }]); } },
        visualMap: { show: false, min: 0, max: Math.max.apply(null, vals.concat([1])), inRange: { color: [css("--dk-accent-soft"), css("--dk-accent")] } },
        calendar: { range: [first, lastDay], top: 22, left: 30, right: 6, bottom: 4, cellSize: ["auto", 15], itemStyle: { borderWidth: 3, borderColor: css("--dk-surface"), color: css("--dk-surface-2") }, splitLine: { show: false }, yearLabel: { show: false }, dayLabel: { firstDay: 1, nameMap: ["S", "M", "T", "W", "T", "F", "S"], color: css("--dk-muted"), fontSize: 10.5 }, monthLabel: { color: css("--dk-muted"), fontSize: 11 } },
        series: [{ type: "heatmap", coordinateSystem: "calendar", data: rows.map(function (r) { return [r.__day, Number(r[o.value]) || 0]; }), itemStyle: { borderRadius: 3 } }],
      };
    }, [{ key: o.date, label: o.dateLabel || o.date, format: "date" }, { key: o.value, label: o.valueLabel || o.value, format: o.format, bar: true }], [o.date], "item");
  }

  // ---------- section heading (report layouts) ----------
  // Dash.section("#el", { title, text }) on a span-12 element between groups of cards
  function section(target, o) {
    var n = el(target);
    n.classList.add("dk-section");
    n.innerHTML = '<h2 class="dk-section-title">' + esc(o.title) + "</h2>" + (o.text ? '<p class="dk-section-text">' + esc(o.text) + "</p>" : "");
    return n;
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
    theme: theme, hero: hero, stats: stats, feed: feed, timeline: timeline, progress: progress, calendar: calendar, section: section,
    drill: function (spec, row) { drillOpen(spec, row || {}, []); }, closeDrawer: closeDrawer,
    palette: palette, css: css, rerender: rerenderAll,
  };
})();
