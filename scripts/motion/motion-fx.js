// Motion Prompt × HyperFrames: bản port các hiệu ứng Motion Prompt sang GSAP timeline của repo.
// Motion Prompt #001-144 · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/
// Mỗi hàm bên dưới ghi số hiệu gốc; thời gian, easing, biên độ lấy từ spec + code gốc (vendor/motion-prompt/api/v1/en/e/<id>.txt).
//
// Nguyên tắc:
//  - Mọi hiệu ứng là HÀM THUẦN của thời gian t (giống phần tử gốc là hàm thuần của u). Một tween "mpDrive" phủ cả timeline
//    gọi MP.render(t) qua plugin GSAP, nên tua tới đâu, worker nào render khung nào cũng ra y như nhau (không dựa vào onUpdate).
//  - Chỉ ghi các thuộc tính CSS riêng lẻ (translate / scale / rotate / filter / clip-path) hoặc phần tử tự tạo, không đụng
//    `transform`, `opacity`, `x/y` mà timeline gốc đang dùng. Trùng thuộc tính với tween gốc → bỏ qua hiệu ứng (hoặc dùng phương án dự phòng).
//  - Lỗi trong một hiệu ứng không làm hỏng video: bắt lỗi, ghi vào MP.log, timeline gốc chạy như cũ.
(function () {
  const MP = (window.MP = window.MP || {});
  MP.version = "1.0.0";
  MP.log = [];
  const jobs = [];
  const slots = new Map();

  // ---------- easing và hàm tiện ích (chép từ kit "motion"/"motion2") ----------
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, x) => a + (b - a) * x;
  const P = (t, a, b) => clamp((t - a) / (b - a));
  const eIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  const eIOs = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const eOut = (x) => 1 - Math.pow(1 - x, 3);
  const eOut5 = (x) => 1 - Math.pow(1 - x, 5);
  const backOut = (x, s = 1.70158) => 1 + (s + 1) * Math.pow(x - 1, 3) + s * Math.pow(x - 1, 2);
  const G = (t, c, w) => Math.exp(-Math.pow((t - c) / w, 2));
  const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return (h ^ (h >>> 16)) / 4294967296; };
  const $ = (s, r = document) => (typeof s === "string" ? r.querySelector(s) : s);

  // ---------- ghi thuộc tính theo khung ----------
  // slot = một phần tử dùng chung (stage, thẻ, nhân vật): nhiều hiệu ứng cộng dồn vào acc, cuối khung mới ghi ra style.
  // GSAP 3.13 gộp các thuộc tính CSS translate/scale/rotate vào `transform` của nó khi lần đầu đọc transform của phần tử,
  // nên phần tử nào timeline gốc có tween transform thì hiệu ứng KHÔNG ghi lên nó mà ghi lên một lớp bọc riêng (.mp-wrap).
  const TRANSFORM = new Set(["x", "y", "z", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotation", "rotate", "rotationX", "rotationY", "skewX", "skewY", "transform", "translate"]);
  const gsapMoves = (el) => !!el._gsap || (tlRef && tlRef.getTweensOf(el).some((tw) => Object.keys(tw.vars).some((k) => TRANSFORM.has(k))));
  function wrap(el) {
    const cs = getComputedStyle(el);
    const w = document.createElement("div");
    w.className = "mp-wrap";
    if (cs.position === "absolute" || cs.position === "fixed") Object.assign(w.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    else w.style.display = cs.display === "inline" ? "inline-block" : cs.display;
    el.parentNode.insertBefore(w, el);
    w.appendChild(el);
    if (w.style.position === "absolute") w.style.transformOrigin = `${el.offsetLeft + el.offsetWidth / 2}px ${el.offsetTop + el.offsetHeight / 2}px`;
    return w;
  }
  function slot(el) {
    if (!slots.has(el)) {
      const svgChild = el instanceof SVGElement && el.tagName.toLowerCase() !== "svg";
      const moved = gsapMoves(el);
      if (svgChild && moved) throw new Error("phần tử SVG đang được GSAP biến đổi");
      if (moved && el.matches(".clip, [data-composition-id]")) throw new Error("không bọc clip của HyperFrames");
      const box = el.getBBox ? el.getBBox() : { width: el.offsetWidth, height: el.offsetHeight };
      // own = lớp mình toàn quyền (ghi `transform`); direct = phần tử GSAP không đụng (ghi translate/scale/rotate riêng lẻ)
      slots.set(el, { node: moved ? wrap(el) : el, own: moved, w: box.width, h: box.height, acc: null });
    }
    return slots.get(el);
  }
  const fresh = () => ({ tx: 0, ty: 0, rot: 0, sx: 1, sy: 1, blur: 0, blurX: 0 });
  let blurNode = null;
  function blurX() {
    if (!blurNode) {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute("width", "0"); svg.setAttribute("height", "0"); svg.style.position = "absolute";
      svg.innerHTML = `<filter id="mpBlurX" x="-30%" y="0" width="160%" height="100%" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="0 0"/></filter>`;
      document.body.appendChild(svg);
      blurNode = svg.querySelector("feGaussianBlur");
    }
    return blurNode;
  }
  function flush() {
    for (const s of slots.values()) {
      const a = s.acc || fresh();
      const st = s.node.style;
      const T = a.tx || a.ty ? `${a.tx.toFixed(2)}px ${a.ty.toFixed(2)}px` : "";
      const S = a.sx !== 1 || a.sy !== 1 ? `${a.sx.toFixed(4)} ${a.sy.toFixed(4)}` : "";
      const R = a.rot ? `${a.rot.toFixed(3)}deg` : "";
      if (s.own) st.transform = (T ? `translate(${T.replace(" ", ", ")}) ` : "") + (R ? `rotate(${R}) ` : "") + (S ? `scale(${S.replace(" ", ", ")})` : "");
      else (st.translate = T), (st.scale = S), (st.rotate = R);
      const f = [];
      if (a.blur > 0.05) f.push(`blur(${a.blur.toFixed(2)}px)`);
      if (a.blurX > 0.3) { blurX().setAttribute("stdDeviation", `${a.blurX.toFixed(1)} 0`); f.push("url(#mpBlurX)"); }
      if (f.length) (st.filter = f.join(" ")), (s.fl = true);
      else if (s.fl) (st.filter = ""), (s.fl = false);
      s.acc = null;
    }
  }
  MP.render = function (t) {
    for (const j of jobs) {
      try { j(t, (el) => { const s = slot(el); s.used = true; return (s.acc = s.acc || fresh()); }); } catch (e) { /* một hiệu ứng lỗi không kéo cả khung */ }
    }
    flush();
  };

  // ---------- dò phần tử trong cảnh ----------
  let stage = null, tlRef = null;
  function effOpacity(el) {
    let o = 1;
    for (let e = el; e && e !== stage; e = e.parentElement) {
      const cs = getComputedStyle(e);
      // không xét visibility: runtime HyperFrames ẩn .clip bằng visibility lúc khởi tạo và giá trị này kế thừa xuống con
      if (cs.display === "none") return 0;
      o *= parseFloat(cs.opacity);
    }
    return o;
  }
  function candidates() {
    const out = [];
    stage.querySelectorAll("[id], .card, .tag, .sau, .vis").forEach((el) => {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") return; // phần tử bên trong SVG thế giới: bỏ
      if (el.tagName.toLowerCase() === "svg") return;
      const r = el.getBoundingClientRect();
      if (r.width >= 1000 && r.height >= 1700) return; // lớp phủ toàn khung (#dim, #shTop…)
      if (!el.textContent.trim() && !el.querySelector("svg, img")) return;
      out.push(el);
    });
    return out;
  }
  // Lấy mẫu độ hiện của các ứng viên quanh mốc `at`; trả về thời điểm bắt đầu hiện (te), hiện rõ (tf), bắt đầu tắt (tx).
  function probe(at, end) {
    const list = candidates();
    const t0 = Math.max(0, at - 0.5), t1 = Math.max(at + 1.8, Math.min(end, at + 6));
    const step = 0.05, rows = list.map(() => []), texts = list.map(() => new Set());
    for (let t = t0; t <= t1 + 1e-6; t += step) {
      tlRef.seek(t, true);
      list.forEach((el, i) => { rows[i].push(effOpacity(el)); texts[i].add(el.textContent); });
    }
    const res = [];
    list.forEach((el, i) => {
      const o = rows[i];
      let k = o.findIndex((v, j) => j > 0 && v > 0.02 && o[j - 1] <= 0.02);
      if (k < 0) return;
      const te = t0 + k * step;
      if (te < at - 0.45 || te > Math.max(at + 1.6, end - 0.6)) return;
      const kf = o.findIndex((v, j) => j >= k && v > 0.95);
      const kx = o.findIndex((v, j) => j > (kf < 0 ? k : kf) && v < 0.5);
      res.push({ el, te, tf: kf < 0 ? te + 0.4 : t0 + kf * step, tx: kx < 0 ? end : t0 + kx * step, textChanges: texts[i].size > 1 });
    });
    return res;
  }

  // ---------- trùng thuộc tính với timeline gốc ----------
  const SPECIAL = new Set(["duration", "delay", "ease", "immediateRender", "onUpdate", "onComplete", "onStart", "stagger", "repeat", "yoyo", "overwrite", "svgOrigin", "transformOrigin", "id", "lazy", "callbackScope", "data", "startAt", "runBackwards"]);
  function busy(el, props, a, b) {
    const hit = [];
    for (const tw of tlRef.getTweensOf(el)) {
      const s = tw.startTime(), e = s + tw.duration();
      if (e < a - 0.05 || s > b + 0.05) continue;
      for (const k of Object.keys(tw.vars)) if (!SPECIAL.has(k) && props.includes(k)) hit.push(k);
    }
    return hit;
  }
  // Hai hiệu ứng MP trên cùng một phần tử, cùng lúc → hiệu ứng sau bị từ chối.
  const claims = [];
  function claim(el, a, b, tag) {
    for (const c of claims) if (c.el === el && !(b < c.a || a > c.b)) throw new Error(`đã có ${c.tag} trên phần tử này cùng lúc`);
    claims.push({ el, a, b, tag });
  }
  function wrapInner(line, cls) {
    let w = line.querySelector(`:scope > .${cls}`);
    if (w) return w;
    w = document.createElement("span");
    w.className = cls;
    w.style.display = "inline-block";
    while (line.firstChild) w.appendChild(line.firstChild);
    line.appendChild(w);
    return w;
  }
  function accent() {
    if (MP.opts.accent) return MP.opts.accent;
    const v = getComputedStyle(document.documentElement).getPropertyValue("--acc").trim();
    if (v) return v;
    const a = stage.querySelector(".a");
    return a ? getComputedStyle(a).color : "#ff5a3c";
  }
  const lines = (el) => { const h = el.matches(".h") ? el : el.querySelector(".h") || el; const b = [...h.querySelectorAll(".blk")]; return b.length ? b : [h]; };

  // ---------- các hiệu ứng ----------
  const FX = {};
  // #005 Mask reveal · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#005
  FX.maskReveal = ({ el, te }) => {
    const ls = lines(el);
    if (ls.some((l) => busy(l, ["clipPath", "y", "yPercent"], te, te + 2.3).length)) throw new Error("dòng chữ đang có tween riêng");
    claim(el, te, te + 2.3, "maskReveal");
    const ins = ls.map((l) => { l.style.clipPath = "inset(-0.4em -80px -0.16em -80px)"; return wrapInner(l, "mp-in"); });
    const host = ls[ls.length - 1];
    const bar = document.createElement("i");
    bar.className = "mp-bar";
    Object.assign(bar.style, { position: "absolute", left: "50%", height: "10px", borderRadius: "5px", background: accent(), opacity: 0, pointerEvents: "none" });
    const box = el.matches(".h") ? el : el.querySelector(".h") || el;
    if (getComputedStyle(box).position === "static") box.style.position = "relative";
    box.appendChild(bar);
    const W = Math.min(610, box.offsetWidth * 0.7);
    bar.style.width = W + "px"; bar.style.marginLeft = -W / 2 + "px"; bar.style.top = host.offsetTop + host.offsetHeight + 6 + "px";
    jobs.push((t) => {
      const u = t - te;
      ins.forEach((w, i) => {
        if (u < 0) { w.style.translate = ""; return; }
        const p = eOut5(P(u, 0.35 + 0.2 * i, 1.0 + 0.15 * i));
        w.style.translate = `0 ${((1 - p) * 1.3 * ls[i].offsetHeight).toFixed(2)}px`;
      });
      const lg = u < 0 ? 0 : eIO(P(u, 0.1, 0.5)) * (1 - eIO(P(u, 2.05, 2.3)));
      bar.style.opacity = lg > 0.005 ? 1 : 0;
      bar.style.scale = `${lg.toFixed(4)} 1`;
    });
    return { target: el.id || ls[0].textContent.trim() };
  };

  // #007 Count-up · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#007
  const NUM = /\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:,\d+)?/;
  FX.countUp = ({ el, te, tx, textChanges }) => {
    if (textChanges) throw new Error("chữ số đang được timeline gốc thay đổi");
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) if (NUM.test(node.nodeValue) && !node.parentElement.closest("svg")) break;
    if (!node) throw new Error("không thấy chữ số");
    const m = node.nodeValue.match(NUM);
    const raw = m[0], dec = raw.includes(",") ? raw.split(",")[1].length : 0;
    const N = parseFloat(raw.replace(/\./g, "").replace(",", "."));
    if (!(N >= 2)) throw new Error("số quá nhỏ để đếm");
    if (/^(1[89]|20)\d{2}$/.test(raw)) throw new Error("số năm, không đếm");
    const fmt = (v) => { const [i, d] = v.toFixed(dec).split("."); return (raw.includes(".") ? i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") : i) + (d ? "," + d : ""); };
    const after = node.splitText(m.index);
    after.nodeValue = after.nodeValue.slice(raw.length);
    const span = document.createElement("span");
    span.className = "mp-num"; span.style.display = "inline-block";
    span.textContent = raw;
    after.parentNode.insertBefore(span, after);
    const slotLen = Math.max(1, tx - te);
    const D = Math.min(2.45, Math.max(0.8, slotLen * 0.5));
    const st = te + 0.15;
    claim(span, te, st + D + 1, "countUp");
    jobs.push((t) => {
      if (t < te) { span.textContent = raw; span.style.scale = ""; return; }
      const p = P(t, st, st + D);
      span.textContent = p >= 1 ? raw : fmt(N * (1 - Math.pow(1 - p, 4)));
      span.style.fontVariantNumeric = p < 1 ? "tabular-nums" : ""; // số không nhảy ngang khi đang đếm; đếm xong trả dáng chữ gốc
      const tau = t - st - D;
      span.style.scale = tau > 0 && tau < 1 ? String((1 + 0.07 * Math.exp(-7 * tau) * Math.cos(15 * tau)).toFixed(4)) : "";
    });
    return { target: raw, note: D < 2.45 ? `rút thời gian đếm còn ${D.toFixed(2)} s cho vừa cảnh` : "" };
  };

  // #024 Impact shake · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#024
  FX.impactShake = ({ el, tf }) => {
    const tI = tf;
    if (busy(stage, ["filter"], tI, tI + 1.1).length) throw new Error("stage đang có filter");
    claim(stage, tI, tI + 1.1, "impactShake"); slot(stage); slot(el);
    jobs.push((t, acc) => {
      const tau = t - tI;
      if (tau <= 0 || tau >= 1.1) return;
      const e = Math.exp(-5 * tau), ph = 2 * Math.PI * 5 * tau, a = acc(stage);
      a.tx += 30 * e * Math.sin(ph); a.ty += 22 * e * Math.cos(ph * 1.3); a.rot += 1.146 * e * Math.sin(ph + 0.6);
      if (tau < 0.3) { const sq = 1 - 0.22 * Math.sin((tau / 0.3) * Math.PI), b = acc(el), h = slot(el).h; b.sx *= 2 - sq; b.sy *= sq; b.ty += ((1 - sq) * h) / 2; }
    });
    return { target: el.id || "stage" };
  };

  // #010 Overshoot · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#010
  FX.overshoot = ({ el, te }) => {
    claim(el, te, te + 1.2, "overshoot"); slot(el);
    jobs.push((t, acc) => {
      const tau = t - te;
      if (tau < 0 || tau > 1.2) return;
      const s = 1 - Math.exp(-4.6 * tau) * Math.cos(10.5 * tau), k = 0.7 + 0.3 * s, a = acc(el);
      a.sx *= k; a.sy *= k;
    });
    return { target: el.id || el.className };
  };

  // #001 Pop-in · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#001
  FX.popIn = ({ el, te }) => {
    if (el.getBoundingClientRect().width > 520) throw new Error("vật lớn hơn 520 px, không hợp pop-in");
    claim(el, te, te + 1, "popIn"); slot(el);
    jobs.push((t, acc) => {
      const tau = t - te;
      if (tau < 0 || tau > 1) return;
      const s = 1 - Math.exp(-6.5 * tau) * Math.cos(15 * tau), a = acc(el);
      a.sx *= s; a.sy *= s; a.rot += -20 * Math.exp(-6 * tau) * Math.cos(11 * tau);
    });
    return { target: el.id || el.className };
  };

  // #002 Stagger · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#002
  FX.stagger = ({ el, te }) => {
    const host = [el, ...el.querySelectorAll("*")].find((n) => n.children.length >= 3 && [...n.children].every((c) => c.tagName === n.children[0].tagName));
    if (!host) throw new Error("không thấy danh sách ≥ 3 món");
    const items = [...host.children];
    if (items.some((c) => tlRef.getTweensOf(c).length)) throw new Error("các món đã có chuyển động riêng trong bản gốc");
    claim(host, te, te + 1.5, "stagger"); items.forEach(slot);
    jobs.push((t, acc) => {
      const tau = t - te;
      if (tau < 0 || tau > 0.15 + 0.12 * items.length + 0.6) return;
      items.forEach((c, i) => { const p = backOut(P(tau, 0.15 + 0.12 * i, 0.65 + 0.12 * i), 2.6), a = acc(c); a.sy *= p; a.ty += ((1 - p) * slot(c).h) / 2; });
    });
    return { target: `${items.length} món` };
  };

  // #080 Highlighter animation · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#080
  FX.highlighter = ({ el, te }) => {
    const ls = lines(el);
    const line = ls.find((l) => l.matches(".a")) || ls[ls.length - 1];
    const w = wrapInner(line, "mp-hl");
    const col = `color-mix(in srgb, ${accent()} 24%, transparent)`;
    Object.assign(w.style, { backgroundImage: `linear-gradient(${col}, ${col})`, backgroundRepeat: "no-repeat", backgroundPosition: "0 92%", backgroundSize: "0% 0.32em" });
    claim(w, te, te + 1.3, "highlighter");
    jobs.push((t) => { const p = t < te ? 0 : eOut(P(t, te + 0.45, te + 1.25)); w.style.backgroundSize = `${(p * 100).toFixed(2)}% 0.32em`; });
    return { target: line.textContent.trim() };
  };

  // #022 Light sweep · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#022
  FX.lightSweep = ({ el, te }) => {
    const card = el.matches(".card") ? el : el.querySelector(".card") || el;
    const bg = getComputedStyle(card).backgroundColor.match(/\d+(\.\d+)?/g);
    if (!bg || (bg[3] !== undefined && +bg[3] < 0.5)) throw new Error("thẻ không có nền đặc");
    const lum = (0.2126 * bg[0] + 0.7152 * bg[1] + 0.0722 * bg[2]) / 255;
    if (lum > 0.82) throw new Error("thẻ nền sáng, vệt sáng không thấy");
    if (getComputedStyle(card).position === "static") card.style.position = "relative";
    const W = card.offsetWidth, k = W / 400;
    const ov = document.createElement("i");
    ov.className = "mp-sweep";
    Object.assign(ov.style, { position: "absolute", inset: 0, borderRadius: "inherit", overflow: "hidden", pointerEvents: "none" });
    const band = (bw, alpha, off) => `<b style="position:absolute;top:-50%;bottom:-50%;left:${off}px;width:${bw}px;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,${alpha}),rgba(255,255,255,0));rotate:24deg"></b>`;
    ov.innerHTML = `<span style="position:absolute;inset:0">${band(116 * k, 0.72, 0)}${band(12 * k, 0.5, 78 * k + 116 * k)}</span>`;
    card.appendChild(ov);
    const mover = ov.firstChild;
    claim(card, te, te + 1.6, "lightSweep");
    jobs.push((t) => { const q = eIOs(P(t - te, 0.45, 1.5)); mover.style.translate = `${(-130 * k - 220 * k + q * (W + 260 * k + 220 * k)).toFixed(1)}px 0`; mover.style.opacity = t - te > 0.4 && t - te < 1.55 ? 1 : 0; });
    return { target: card.id || "card" };
  };

  // #129 Text scramble · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#129
  FX.scramble = ({ el, te, textChanges }) => {
    if (textChanges) throw new Error("chữ đang được timeline gốc thay đổi");
    const line = lines(el)[0];
    const orig = line.innerHTML, text = line.textContent;
    const chars = [...text], n = chars.filter((c) => c.trim()).length;
    if (n > 24) throw new Error("dòng quá dài cho scramble");
    const stepI = Math.min(0.18, 1.0 / n), POOL = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#$%&@?", acc = accent();
    claim(line, te, te + 0.45 + stepI * n + 0.5, "scramble");
    let last = "";
    jobs.push((t) => {
      const u = t - te;
      if (u < 0 || u > 0.45 + stepI * n + 0.5) { if (last !== "o") { line.innerHTML = orig; last = "o"; } return; }
      const k = Math.floor(u / 0.062);
      let j = 0, html = "";
      for (const c of chars) {
        if (!c.trim()) { html += c; continue; }
        const lock = 0.45 + stepI * j, r = hash(j, k);
        if (u >= lock) { const a = u - lock; html += `<span style="display:inline-block;${a < 0.22 ? `color:${acc};` : ""}scale:${(1 + 0.2 * Math.exp(-14 * a)).toFixed(3)}">${c}</span>`; }
        else { const ch = POOL[Math.floor(r * POOL.length)]; html += `<span style="opacity:.75">${c === c.toLowerCase() ? ch.toLowerCase() : ch}</span>`; }
        j++;
      }
      if (html !== last) { line.innerHTML = html; last = html; }
    });
    return { target: text.trim() };
  };

  // #043 Whip pan · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#043
  FX.whipPan = ({ at }) => {
    const a0 = at - 0.4;
    if (busy(stage, ["filter"], a0, at + 0.4).length) throw new Error("stage đang có filter");
    claim(stage, a0, at + 0.4, "whipPan"); slot(stage);
    jobs.push((t, acc) => {
      const u = t - a0;
      if (u <= 0 || u >= 0.8) return;
      const a = acc(stage);
      if (u < 0.4) { const q = eIOs(u / 0.4); a.tx += -300 * q; a.blurX = Math.max(a.blurX, 34 * q); }
      else { const q = eIOs((u - 0.4) / 0.4); a.tx += 300 * (1 - q); a.blurX = Math.max(a.blurX, 34 * (1 - q)); }
    });
    return { target: "stage", note: `điểm đổi cảnh ${at.toFixed(2)} s` };
  };

  // #046 Smash cut · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#046
  FX.smashCut = ({ at }) => {
    claim(stage, at, at + 1.5, "smashCut"); slot(stage);
    jobs.push((t, acc) => {
      const u = t - at;
      if (u < 0 || u >= 1.5) return;
      const k = u < 0.9 ? 1 : 1 - eIOs((u - 0.9) / 0.6), a = acc(stage), sh = Math.exp(-3 * u);
      a.sx *= 1 + 0.06 * k; a.sy *= 1 + 0.06 * k;
      a.rot += (-3 + 1.7 * Math.sin(2 * Math.PI * 6 * u) * sh) * k;
      a.tx += 6 * Math.sin(2 * Math.PI * 8 * u) * sh * k;
    });
    return { target: "stage" };
  };

  // #027 Dolly in · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#027
  const world = () => $(MP.opts.world || "#W", stage) || stage.querySelector(":scope > svg");
  FX.dollyIn = ({ at, end }) => {
    const w = world();
    if (!w) throw new Error("post không có thế giới SVG (#W)");
    const D = Math.min(2.9, Math.max(1.2, end - at - 0.6));
    claim(w, at, end, "dollyIn"); slot(w);
    jobs.push((t, acc) => {
      if (t < at || t > end) return;
      const k = 1 + 0.1 * eIO(P(t, at, at + D)) * (1 - eIOs(P(t, end - 0.5, end))), a = acc(w);
      a.sx *= k; a.sy *= k;
    });
    return { target: w.id || "world", note: "zoom phẳng (không có thị sai)" };
  };

  // #033 Rack focus · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#033
  FX.rackFocus = ({ el, te, tx }) => {
    const w = world();
    if (!w) throw new Error("post không có thế giới SVG (#W)");
    if (el.contains(w) || w.contains(el)) throw new Error("thẻ nằm chung lớp với thế giới");
    if (getComputedStyle(w).filter !== "none" || busy(w, ["filter"], te, tx).length) throw new Error("thế giới đang có filter");
    const D = Math.min(1.6, Math.max(0.5, (tx - te) * 0.35));
    claim(w, te, tx + 0.5, "rackFocus"); slot(w);
    jobs.push((t, acc) => {
      if (t < te || t > tx + 0.5) return;
      const b = 6 * eIO(P(t, te, te + D)) * (1 - eIO(P(t, tx, tx + 0.5))), a = acc(w);
      a.blur = Math.max(a.blur, b);
    });
    return { target: el.id || "card", note: `kéo nét ${D.toFixed(2)} s` };
  };

  // Nhân vật: giới hạn lấy từ characters.json (MP.opts.characters)
  const charOf = (el) => {
    const cs = MP.opts.characters || {};
    for (const [key, c] of Object.entries(cs)) { const n = el.matches(c.selector) ? el : el.querySelector(c.selector); if (n) return { key, c, node: n }; }
    return null;
  };
  // #121 Anticipation · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#121
  FX.anticipation = ({ el, te }) => {
    const ch = charOf(el);
    if (!ch) throw new Error("không thấy nhân vật trong cảnh");
    const { maxSquash, maxJumpPx } = ch.c.limits, f = maxSquash / 0.22, J = maxJumpPx, node = ch.node;
    claim(node, te, te + 1.4, "anticipation"); slot(node);
    jobs.push((t, acc) => {
      const tau = t - te;
      if (tau < 0 || tau > 1.4) return;
      const a = acc(node), h = slot(node).h;
      let sx = 1, sy = 1, dy = 0;
      if (tau < 0.45) { const q = eIOs(tau / 0.45); sx = 1 + 0.22 * f * q; sy = 1 - 0.24 * f * q; dy = 0.5 * J * q; }
      else if (tau < 0.88) { const L = (tau - 0.45) / 0.43, p = backOut(L, 1.1), s = Math.sin(Math.PI * Math.min(1, L / 0.6)); sx = 1 - 0.28 * f * s; sy = 1 + 0.55 * f * s; dy = lerp(0.5 * J, 0, p) - J * Math.sin(Math.PI * L) * 0.6; }
      else { const tw = tau - 0.88, wob = 0.13 * f * Math.exp(-7 * tw) * Math.sin(17 * tw); sx = 1 + wob; sy = 1 - wob; }
      a.sx *= sx; a.sy *= sy; a.ty += dy + ((1 - sy) * h) / 2;
    });
    return { target: ch.c.name };
  };
  // #122 Follow-through · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#122
  FX.followThrough = ({ el, te }) => {
    const ch = charOf(el);
    if (!ch) throw new Error("không thấy nhân vật trong cảnh");
    const head = ch.node.querySelector(ch.c.parts && ch.c.parts.head);
    if (!head) throw new Error("nhân vật không có lớp đầu");
    if (tlRef.getTweensOf(head).length) throw new Error("lớp đầu đã có chuyển động riêng");
    head.style.transformBox = "fill-box"; head.style.transformOrigin = "50% 88%";
    const A = ch.c.limits.maxRotateDeg, t0 = te + 0.85;
    claim(head, t0, t0 + 2, "followThrough"); slot(head);
    jobs.push((t, acc) => { const tau = t - t0; if (tau < 0 || tau > 2) return; acc(head).rot += A * Math.exp(-2.75 * tau) * Math.sin(11 * tau); });
    return { target: `${ch.c.name} (.head)` };
  };

  // #123 Bounce · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#123
  FX.bounceDrop = ({ el, te }) => {
    const ch = charOf(el), lim = ch ? ch.c.limits : null;
    const k = 1.6, g = 1900 * k, H = lim ? Math.min(190 * k, lim.maxJumpPx * 3) : 190 * k, vmin = 35 * k, e = 0.56;
    const segs = []; let t = Math.sqrt((2 * H) / g), v = g * t; segs.push({ a: 0, b: t, v0: 0, y0: H, fall: true, vImp: v });
    while (v * e > vmin) { v *= e; const d = (2 * v) / g; segs.push({ a: t, b: t + d, v0: v, vImp: v }); t += d; }
    const T = t, sqMax = lim ? lim.maxSquash : 0.4, node = ch ? ch.node : el;
    claim(node, te, te + T + 0.1, "bounceDrop"); slot(node);
    jobs.push((tt, acc) => {
      const tau = tt - te;
      if (tau < 0 || tau > T + 0.05) return;
      let y = 0;
      for (const s of segs) if (tau >= s.a && tau < s.b) { const l = tau - s.a; y = s.fall ? H - 0.5 * g * l * l : s.v0 * l - 0.5 * g * l * l; }
      let sq = 0;
      for (const s of segs) { const d = Math.abs(tau - s.b); if (d < 0.045) sq = Math.max(sq, sqMax * Math.min(1, s.vImp / (850 * k)) * (1 - d / 0.045)); }
      const a = acc(node), h = slot(node).h;
      a.ty += -y + (sq * h) / 2; a.sx *= 1 + sq; a.sy *= 1 - sq;
    });
    return { target: node.id || node.className };
  };

  // #125 Pulse · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#125
  FX.pulse = ({ el, te }) => {
    if (getComputedStyle(el).position === "static") el.style.position = "relative";
    const ring = document.createElement("i");
    Object.assign(ring.style, { position: "absolute", inset: 0, border: `6px solid ${accent()}`, borderRadius: getComputedStyle(el).borderRadius || "999px", opacity: 0, pointerEvents: "none" });
    el.appendChild(ring);
    const t0 = te + 0.3, B = 1.175, N = 2;
    claim(el, t0, t0 + B * N, "pulse"); slot(el);
    jobs.push((t, acc) => {
      const l0 = t - t0;
      if (l0 < 0 || l0 > B * N) { ring.style.opacity = 0; return; }
      const l = l0 % B, s = 1 + 0.26 * G(l, 0.2, 0.065) + 0.15 * G(l, 0.44, 0.07), a = acc(el);
      a.sx *= s; a.sy *= s;
      const r = Math.max(P(l, 0.16, 0.96), 0), q = eOut(r);
      ring.style.opacity = l > 0.16 && l < 0.96 ? (0.75 * (1 - r)).toFixed(3) : 0;
      ring.style.scale = String((1.2 + 1.2 * q).toFixed(3));
    });
    return { target: el.id || "follow" };
  };

  // #004 Line draw · MIT License (c) 2026 Shohei Ohtaki · https://showheyohtaki.github.io/motion-prompt/#004
  FX.lineDraw = ({ el, te }) => {
    const paths = el.tagName.toLowerCase() === "path" ? [el] : [...el.querySelectorAll("path, line, polyline")];
    if (!paths.length) throw new Error("không có path để vẽ");
    if (paths.some((p) => busy(p, ["strokeDashoffset", "strokeDasharray", "drawSVG"], te, te + 2).length)) throw new Error("path đã có tween nét vẽ");
    const L = paths.map((p) => p.getTotalLength());
    paths.forEach((p, i) => { p.style.strokeDasharray = `${L[i]} ${L[i]}`; });
    jobs.push((t) => paths.forEach((p, i) => { const a = 0.08 + 0.3 * i, q = t < te ? 1 : eIO(P(t - te, a, a + 1.55)); p.style.strokeDashoffset = (L[i] * (1 - q)).toFixed(2); }));
    return { target: `${paths.length} nét` };
  };

  MP.FX = FX;

  // ---------- gắn vào timeline ----------
  let driven = false;
  function drive(tl, dur) {
    if (driven) return;
    driven = true;
    if (!gsap.plugins || !gsap.plugins.mpDrive) {
      gsap.registerPlugin({ name: "mpDrive", init(target, v) { this.d = v; }, render(r, data) { MP.render(r * data.d); } });
    }
    tl.to({}, { mpDrive: dur, duration: dur, ease: "none" }, 0);
  }
  MP.opts = {};
  function setup(tl, opts) {
    tlRef = tl;
    MP.opts = Object.assign(MP.opts, opts || {});
    stage = $(MP.opts.stage || "#stage") || document.querySelector("[data-composition-id]");
  }
  function pickRole(found, role, item) {
    const hint = item.selector && $(item.selector, stage);
    if (hint) return found.find((f) => f.el === hint) || { el: hint, te: item.at, tf: item.at + 0.4, tx: item.end, textChanges: false };
    const by = {
      title: (f) => f.el.matches(".h, .safe") && f.el.querySelector(".blk"),
      number: (f) => NUM.test(f.el.textContent) && !/^(1[89]|20)\d{2}$/.test((f.el.textContent.match(NUM) || [""])[0]),
      card: (f) => f.el.matches(".card, .tag") || f.el.querySelector(".card"),
      small: (f) => f.el.matches(".tag") || f.el.getBoundingClientRect().width <= 520,
      list: (f) => [f.el, ...f.el.querySelectorAll("*")].some((n) => n.children.length >= 3),
      character: (f) => charOf(f.el),
      follow: (f) => /follow|\bflo\b/i.test(f.el.textContent),
    }[role];
    if (!by) return null;
    // vai gần nhau: thiếu thẻ thì dùng nhãn/tiêu đề, thiếu nhãn nhỏ thì dùng thẻ
    const alt = { card: ["small", "title"], small: ["card"] }[role] || [];
    // ưu tiên phần tử hiện gần mốc `at` nhất, rồi phần tử ngoài cùng
    const ok = found.filter(by).sort((a, b) => Math.abs(a.te - item.at) - Math.abs(b.te - item.at) || (a.el.contains(b.el) ? -1 : 1));
    if (ok[0]) return ok[0];
    if (!item._alt) for (const r of alt) { const f = pickRole(found, r, Object.assign({}, item, { selector: null, _alt: true })); if (f) return f; }
    return null;
  }
  // plan = { duration, items: [{ n, id, fx, role, at, end, selector?, fallback: [{id, fx, role}], reason }] }
  MP.apply = function (tl, plan, opts) {
    setup(tl, opts);
    const used = {};
    for (const item of plan.items || []) {
      const chain = [{ id: item.id, fx: item.fx, role: item.role }, ...(item.fallback || [])];
      let done = false, why = [];
      let found = null;
      for (const c of chain) {
        try {
          if (!FX[c.fx]) throw new Error(`chưa có bản port ${c.fx}`);
          if (plan.limits && (used[c.fx] || 0) >= plan.limits[c.fx]) throw new Error(`đã dùng đủ ${plan.limits[c.fx]} lần`);
          let ctx;
          if (c.role === "stage" || c.role === "world") ctx = { el: stage, te: item.at, tf: item.at, tx: item.end };
          else {
            found = found || probe(item.at, item.end);
            const f = pickRole(found, c.role, item);
            if (!f) throw new Error(`không thấy phần tử vai "${c.role}" quanh ${item.at.toFixed(2)} s`);
            ctx = f;
          }
          const r = FX[c.fx](Object.assign({ at: item.at, end: item.end, item }, ctx)) || {};
          MP.log.push({ n: item.n, id: c.id, fx: c.fx, at: item.at, status: c === chain[0] ? "applied" : "fallback", target: r.target, te: ctx.te, note: [r.note, ...why].filter(Boolean).join("; ") });
          used[c.fx] = (used[c.fx] || 0) + 1;
          done = true;
          break;
        } catch (e) {
          why.push(`${c.fx}: ${e.message}`);
        }
      }
      if (!done) MP.log.push({ n: item.n, id: item.id, fx: item.fx, at: item.at, status: "skipped", note: why.join("; ") });
    }
    tl.seek(0, true);
    if (jobs.length) drive(tl, plan.duration || tl.duration());
    window.__MP_LOG = MP.log;
    return MP.log;
  };
  // Dùng tay trong template: MP.use(tl, {duration}); MP.fx("countUp", "#n1", 12.3);
  MP.use = function (tl, opts) { setup(tl, opts); return MP; };
  MP.fx = function (name, selector, at, end) {
    const el = $(selector, stage) || $(selector);
    const r = FX[name]({ el, at, end: end ?? at + 3, te: at, tf: at + 0.4, tx: end ?? at + 3, textChanges: false });
    if (!driven && tlRef) queueMicrotask(() => drive(tlRef, MP.opts.duration || tlRef.duration()));
    return r;
  };
})();
