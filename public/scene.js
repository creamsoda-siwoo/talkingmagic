// 전투 장면: 캔버스에 마법사, 주문, 지속 효과를 실시간으로 그린다.
// 게임 규칙은 모른다. game.js가 시키는 연출만 하고, 맞는 순간을 Promise로 알려 준다.
import { ELEMENT_INFO } from "./rivals.js";

const STYLES = {
  player: { robe: "#6a4bd8", trim: "#f3c969", hat: "#4a2fb0", skin: "#f2c9a0", orb: "#b79bff", scale: 1, star: true },
  pip: { robe: "#3f9c6b", trim: "#d9f2a0", hat: "#2f7a52", skin: "#f5d2b0", orb: "#ffd166", scale: 0.86, bigHat: true },
  evelyn: { robe: "#7fb9e6", trim: "#ffffff", skin: "#eef4ff", orb: "#bff1ff", scale: 1, hair: "#e8f4ff", crown: "#c9f1ff" },
  morgath: { robe: "#3a2352", trim: "#b0244f", hat: "#22122f", skin: "#d9c2b0", orb: "#ff4f7b", scale: 1.12, beard: "#e9e4f0" },
};
const OWNER_COLOR = { player: "#6fe3a5", enemy: "#ff7a8a", field: "#cfc4ff" };
const FONT = "'Noto Sans KR', system-ui, sans-serif";
const MAX_PARTICLES = 420;

const lerp = (a, b, u) => a + (b - a) * u;
const rand = (a, b) => a + Math.random() * (b - a);

export function createScene(canvas) {
  const ctx = canvas.getContext("2d");
  const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, ground = 0, t = 0, shake = 0, last = performance.now();

  const mkActor = (styleId, dir) => ({
    style: STYLES[styleId], dir, x: 0, phase: dir > 0 ? 0 : 1.7,
    castPulse: 0, channel: false, channelText: "", knock: 0, flash: 0, down: 0, downTarget: 0,
  });
  const actors = { player: mkActor("player", 1), enemy: mkActor("pip", -1) };
  const particles = [], shots = [], floats = [];

  const scene = {
    effects: [],      // game.js의 지속 효과 배열을 그대로 참조한다 (remaining/total 초)
    enemyCharge: 0,   // 상대의 다음 기본 공격까지 0~1
    onTick: null,
    setRival(id) { actors.enemy.style = STYLES[id]; },
    reset() {
      for (const a of Object.values(actors)) Object.assign(a, { down: 0, downTarget: 0, channel: false, knock: 0, flash: 0 });
      particles.length = shots.length = floats.length = 0;
      scene.enemyCharge = 0;
    },
    setChannel(side, on, text = "") {
      actors[side].channel = on;
      actors[side].channelText = text.length > 15 ? `${text.slice(0, 15)}…` : text;
    },
    setDown(side) { actors[side].downTarget = 1; actors[side].channel = false; },
    hit(side, big = false) {
      const a = actors[side];
      a.knock = -a.dir * (big ? 16 : 9);
      a.flash = 1;
      if (!calm) shake = Math.max(shake, big ? 9 : 3);
    },
    float(side, text, { color = "#ff8f9c", sub = "", size = 22 } = {}) {
      const a = actors[side];
      floats.push({ x: a.x, y: ground - 118 * a.style.scale, text, sub, color, size, t: 0 });
    },
    /** 효과가 공격을 막아냈을 때 번쩍인다. */
    flashEffect(effect) { effect.hitT = 0.35; },
    /** 주문을 쏜다. 맞는(또는 발동하는) 순간에 resolve된다. */
    launch(side, { form = "projectile", icon = "✨", element = "other", power = 0.5, blocked = false, miss = false }) {
      const a = actors[side];
      const target = actors[side === "player" ? "enemy" : "player"];
      a.castPulse = 1;
      const from = staffTip(a);
      let to = { x: target.x, y: ground - 46 * target.style.scale };
      if (blocked) to = { x: target.x + target.dir * 46, y: ground - 46 };
      if (miss) to = { x: target.x - target.dir * 60, y: ground - 110 };
      const dur = { projectile: 0.62, beam: 0.5, rain: 0.8, barrier: 0.6, aura: 0.7, trap: 0.7, fizzle: 0.6 }[form] ?? 0.62;
      const hitAt = { projectile: 1, beam: 0.3, rain: 0.65, barrier: 0.4, aura: 0.4, trap: 0.5, fizzle: 0.3 }[form] ?? 1;
      return new Promise((resolve) => {
        shots.push({
          form, icon, power, from, to, side, dur, hitAt, t: 0, resolved: false, resolve,
          color: ELEMENT_INFO[element]?.color ?? "#fff", size: 18 + 20 * power,
          chest: { x: a.x, y: ground - 44 * a.style.scale }, dir: a.dir,
        });
      });
    },
  };

  // ---------- 좌표 ----------

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ground = H - 30;
    actors.player.x = Math.max(48, W * 0.15);
    actors.enemy.x = Math.min(W - 48, W * 0.85);
  }
  new ResizeObserver(resize).observe(canvas);

  function castLevel(a) {
    return Math.max(a.channel ? 0.65 + Math.sin(t * 6) * 0.08 : 0, a.castPulse);
  }
  function staffTip(a) {
    const s = a.style.scale, c = castLevel(a);
    return { x: a.x + a.knock + a.dir * s * (25 + c * 8), y: ground - s * (84 + c * 10) };
  }

  // ---------- 입자 ----------

  function emit(x, y, color, { n = 1, speed = 40, size = 3, life = 0.5, grav = 0, vx = 0, vy = 0 } = {}) {
    for (let i = 0; i < n && particles.length < MAX_PARTICLES; i++) {
      const ang = rand(0, Math.PI * 2), sp = rand(0.3, 1) * speed;
      particles.push({
        x, y, vx: Math.cos(ang) * sp + vx, vy: Math.sin(ang) * sp + vy,
        life, max: life, size: rand(0.6, 1.2) * size, color, grav,
      });
    }
  }
  const burst = (p, color, power) => {
    emit(p.x, p.y, color, { n: Math.round(10 + power * 26), speed: 90 + power * 120, size: 3.5, life: 0.55, grav: 120 });
    emit(p.x, p.y, "#ffffff", { n: 6, speed: 60, size: 2.5, life: 0.3 });
  };

  // ---------- 갱신 ----------

  function update(dt) {
    t += dt;
    shake = Math.max(0, shake - dt * 30);
    for (const a of Object.values(actors)) {
      a.castPulse = Math.max(0, a.castPulse - dt * 2.2);
      a.knock *= Math.pow(0.002, dt);
      a.flash = Math.max(0, a.flash - dt * 5);
      a.down = lerp(a.down, a.downTarget, Math.min(1, dt * 6));
      if (a.channel) {
        const tip = staffTip(a);
        const ang = rand(0, Math.PI * 2), r = rand(26, 44);
        emit(tip.x + Math.cos(ang) * r, tip.y + Math.sin(ang) * r, a.style.orb, {
          speed: 0, size: 2.5, life: 0.4, vx: -Math.cos(ang) * r * 2.4, vy: -Math.sin(ang) * r * 2.4,
        });
      }
    }
    for (const e of scene.effects) if (e.hitT > 0) e.hitT -= dt;

    for (let i = shots.length - 1; i >= 0; i--) {
      const s = shots[i];
      s.t += dt;
      const u = Math.min(1, s.t / s.dur);
      if (s.form === "projectile") {
        const p = shotPos(s, u);
        emit(p.x, p.y, s.color, { n: 2, speed: 22, size: 2 + s.power * 3, life: 0.35 });
      } else if (s.form === "rain" && u < 0.8) {
        emit(s.to.x + rand(-34, 34), lerp(0, s.to.y, u), s.color, { speed: 10, size: 2.5, life: 0.25, vy: 220 });
      } else if (s.form === "barrier" && u < 0.6) {
        emit(s.chest.x + s.dir * 46 + rand(-8, 8), ground, s.color, { speed: 12, size: 3, life: 0.6, vy: -150 });
      } else if (s.form === "aura") {
        const ang = t * 9 + i;
        emit(s.chest.x + Math.cos(ang) * 30, s.chest.y + Math.sin(ang) * 40, s.color, { speed: 8, size: 3, life: 0.5, vy: -40 });
      } else if (s.form === "trap" && u > 0.3) {
        emit(s.to.x + rand(-22, 22), ground, s.color, { speed: 10, size: 2.5, life: 0.5, vy: -90 });
      } else if (s.form === "fizzle") {
        emit(s.from.x, s.from.y, "#9a94b5", { speed: 26, size: 4, life: 0.7, vy: -30 });
      }
      if (!s.resolved && u >= s.hitAt) {
        s.resolved = true;
        if (["projectile", "beam", "rain", "trap"].includes(s.form)) burst(s.to, s.color, s.power);
        s.resolve();
      }
      if (u >= 1) shots.splice(i, 1);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = floats.length - 1; i >= 0; i--) {
      floats[i].t += dt;
      if (floats[i].t > 1.3) floats.splice(i, 1);
    }
  }

  function shotPos(s, u) {
    return {
      x: lerp(s.from.x, s.to.x, u),
      y: lerp(s.from.y, s.to.y, u) - Math.sin(Math.PI * u) * (36 + s.power * 20),
    };
  }

  // ---------- 그리기 ----------

  function ellipse(x, y, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  }

  function drawBackdrop() {
    // 달
    ctx.save();
    ctx.shadowColor = "#cfc4ff"; ctx.shadowBlur = 30;
    ctx.fillStyle = "rgba(231,220,255,.85)";
    ellipse(W * 0.5, 34, 15, 15); ctx.fill();
    ctx.restore();
    // 먼 산과 탑
    ctx.fillStyle = "rgba(40,28,82,.9)";
    ctx.beginPath();
    ctx.moveTo(0, ground - 6);
    ctx.quadraticCurveTo(W * 0.2, ground - 70, W * 0.38, ground - 22);
    ctx.quadraticCurveTo(W * 0.5, ground - 52, W * 0.66, ground - 20);
    ctx.quadraticCurveTo(W * 0.85, ground - 76, W, ground - 10);
    ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.closePath(); ctx.fill();
    ctx.fillRect(W * 0.5 - 5, ground - 62, 10, 46);
    ctx.beginPath();
    ctx.moveTo(W * 0.5 - 8, ground - 62); ctx.lineTo(W * 0.5, ground - 80); ctx.lineTo(W * 0.5 + 8, ground - 62);
    ctx.fill();
    // 결투장 바닥과 룬 고리
    const g = ctx.createLinearGradient(0, ground - 12, 0, H);
    g.addColorStop(0, "#2a1e55"); g.addColorStop(1, "#140e2c");
    ctx.fillStyle = g;
    ctx.fillRect(0, ground - 8, W, H - ground + 8);
    ctx.strokeStyle = "rgba(157,123,255,.45)"; ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]); ctx.lineDashOffset = -t * 8;
    ellipse(W / 2, ground + 6, W * 0.4, 13); ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawWizard(a, charge = 0) {
    const st = a.style, s = st.scale, c = castLevel(a);
    const col = (v) => (a.flash > 0.5 ? "#ffffff" : v);
    const x = a.x + a.knock;

    // 그림자와 시전 중 룬 고리
    ctx.fillStyle = "rgba(0,0,0,.4)";
    ellipse(x, ground + 2, 26 * s, 6 * s); ctx.fill();
    if (a.channel) {
      ctx.strokeStyle = st.orb; ctx.lineWidth = 2;
      ctx.setLineDash([6, 5]); ctx.lineDashOffset = t * 30;
      ctx.globalAlpha = 0.6 + Math.sin(t * 8) * 0.3;
      ellipse(x, ground + 2, 36 * s, 9 * s); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    ctx.save();
    ctx.translate(x, ground);
    ctx.scale(a.dir * s, s);
    ctx.rotate(-a.down * 1.45);
    ctx.translate(0, Math.sin(t * 2 + a.phase) * 2 * (1 - a.down));
    const sway = Math.sin(t * 1.6 + a.phase) * 2.5;

    // 긴 머리 (머리 뒤)
    if (st.hair) { ctx.fillStyle = col(st.hair); ellipse(-5, -54, 11, 20); ctx.fill(); }

    // 로브
    ctx.fillStyle = col(st.robe);
    ctx.beginPath();
    ctx.moveTo(-11, -54); ctx.lineTo(11, -54);
    ctx.quadraticCurveTo(17, -24, 22 + sway, 0);
    ctx.quadraticCurveTo(11, 6, 0, 0);
    ctx.quadraticCurveTo(-11, 6, -22 + sway, 0);
    ctx.quadraticCurveTo(-17, -24, -11, -54);
    ctx.fill();
    ctx.strokeStyle = col(st.trim); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-14, -30); ctx.quadraticCurveTo(0, -26, 14, -30); ctx.stroke();

    // 지팡이와 팔
    const tipX = 25 + c * 8, tipY = -84 - c * 10;
    ctx.strokeStyle = "#8a6238"; ctx.lineWidth = 3; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(19, -4); ctx.lineTo(tipX, tipY + 5); ctx.stroke();
    ctx.strokeStyle = col(st.robe); ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(8, -48); ctx.lineTo(21, -40 - c * 12); ctx.stroke();
    ctx.save();
    ctx.shadowColor = st.orb; ctx.shadowBlur = 12 + (c + charge) * 22;
    ctx.fillStyle = st.orb;
    ellipse(tipX, tipY, 5 + c * 2.5 + charge * 3, 5 + c * 2.5 + charge * 3); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.85)";
    ellipse(tipX - 1.5, tipY - 1.5, 2, 2); ctx.fill();
    ctx.restore();
    if (charge > 0.02) {
      // 다음 공격을 모으는 고리
      ctx.strokeStyle = st.orb; ctx.lineWidth = 2.5;
      ctx.globalAlpha = charge > 0.8 ? 0.6 + Math.sin(t * 24) * 0.4 : 0.8;
      ctx.beginPath(); ctx.arc(tipX, tipY, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * charge); ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 머리
    ctx.fillStyle = col(st.skin);
    ellipse(0, -64, 11, 11); ctx.fill();
    ctx.strokeStyle = ctx.fillStyle = "#2a1e3f"; ctx.lineWidth = 1.6;
    if (a.down > 0.5) {
      for (const ex of [2, 7]) {
        ctx.beginPath(); ctx.moveTo(ex - 2, -67); ctx.lineTo(ex + 2, -63);
        ctx.moveTo(ex + 2, -67); ctx.lineTo(ex - 2, -63); ctx.stroke();
      }
    } else {
      ellipse(2, -65, 1.5, a.flash > 0 ? 0.6 : 1.9); ctx.fill();
      ellipse(7, -65, 1.5, a.flash > 0 ? 0.6 : 1.9); ctx.fill();
    }
    if (st.beard) {
      ctx.fillStyle = col(st.beard);
      ctx.beginPath(); ctx.moveTo(-6, -60); ctx.quadraticCurveTo(4, -52, 11, -61);
      ctx.quadraticCurveTo(9, -40, 4, -32); ctx.quadraticCurveTo(-3, -44, -6, -60); ctx.fill();
    }

    // 모자 또는 얼음 왕관
    if (st.crown) {
      ctx.fillStyle = col(st.crown);
      ctx.beginPath();
      ctx.moveTo(-10, -72);
      for (const [px, py] of [[-7, -86], [-3, -75], [1, -91], [5, -75], [9, -85], [11, -72]]) ctx.lineTo(px, py);
      ctx.closePath(); ctx.fill();
    } else {
      const k = st.bigHat ? 1.3 : 1;
      ctx.fillStyle = col(st.hat);
      ellipse(0, -73, 18 * k, 4.5 * k); ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-11 * k, -74);
      ctx.quadraticCurveTo(-5 * k, -74 - 26 * k, -12 * k, -74 - 34 * k);
      ctx.quadraticCurveTo(6 * k, -74 - 24 * k, 11 * k, -74);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col(st.trim); ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(-10 * k, -77); ctx.quadraticCurveTo(0, -74, 10 * k, -77); ctx.stroke();
      if (st.star) { ctx.fillStyle = col(st.trim); ellipse(-2, -88, 2.5, 2.5); ctx.fill(); }
    }
    ctx.restore();

    // 외우는 중인 주문
    if (a.channel && a.channelText) {
      ctx.font = `500 11px ${FONT}`;
      const w = ctx.measureText(a.channelText).width + 14;
      const bx = Math.max(4, Math.min(W - w - 4, x - w / 2)), by = ground - 128 * s;
      ctx.fillStyle = "rgba(13,11,30,.82)";
      ctx.beginPath(); ctx.roundRect(bx, by, w, 20, 10); ctx.fill();
      ctx.fillStyle = "#efeaff"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
      ctx.fillText(a.channelText, bx + 7, by + 10.5);
    }
  }

  function drawLabel(text, x, y, color) {
    ctx.font = `500 10px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(13,11,30,.9)";
    ctx.strokeText(text, x, y); ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function drawIcon(icon, x, y, size) {
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    ctx.fillText(icon, x, y);
  }
  function drawTimer(e, x, y, r, color) {
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, e.remaining / e.total));
    ctx.stroke();
  }

  /** 전장에 남은 효과: 방벽은 주인 앞에 서고, 상태 이상은 머리 위를 돌고, 날씨는 가운데에 뜬다. */
  function drawEffects() {
    const slot = { player: 0, enemy: 0, field: 0, over_player: 0, over_enemy: 0 };
    const fieldCount = scene.effects.filter((e) => e.where === "field").length;
    for (const e of scene.effects) {
      const color = OWNER_COLOR[e.owner];
      const fading = e.remaining < 4 ? 0.55 + Math.sin(t * 14) * 0.35 : 1;
      const lit = e.hitT > 0;
      ctx.save();
      ctx.globalAlpha = fading;
      if (e.where === "field") {
        const x = W / 2 + (slot.field++ - (fieldCount - 1) / 2) * 58;
        const y = 66 + Math.sin(t * 1.5 + x) * 4;
        if (Math.random() < 0.25) {
          emit(rand(W * 0.25, W * 0.75), rand(ground - 90, ground - 10), color, { speed: 6, size: 5, life: 1.2, vx: rand(-14, 14) });
        }
        drawTimer(e, x, y, 15, color);
        drawIcon(e.icon, x, y + 1, 18);
        drawLabel(e.name, x, y + 24, color);
      } else if (e.owner === e.where) {
        // 지켜 주는 방벽
        const a = actors[e.where];
        const x = a.x + a.dir * (46 + slot[e.where]++ * 28);
        ctx.shadowColor = color; ctx.shadowBlur = lit ? 30 : 12;
        ctx.fillStyle = lit ? "rgba(255,255,255,.8)" : `${color}55`;
        ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x - 7, ground);
        ctx.quadraticCurveTo(x + a.dir * 12, ground - 48, x - 7, ground - 92);
        ctx.lineTo(x + 7, ground - 92);
        ctx.quadraticCurveTo(x + a.dir * 12 + 14, ground - 48, x + 7, ground);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.shadowBlur = 0;
        // 남은 시간만큼 벽이 채워져 보인다
        ctx.fillStyle = color;
        ctx.fillRect(x - 9, ground + 4, 18 * Math.max(0, e.remaining / e.total), 3);
        drawIcon(e.icon, x + a.dir * 4, ground - 50, 18);
        drawLabel(e.name, x, ground + 15, color);
      } else {
        // 걸려 있는 상태 이상
        const a = actors[e.where], k = slot[`over_${e.where}`]++;
        const x = a.x + Math.cos(t * 2 + k * 2.1) * 22;
        const y = ground - 120 * a.style.scale - k * 26 + Math.sin(t * 3 + k) * 3;
        drawTimer(e, x, y, 13, color);
        drawIcon(e.icon, x, y + 1, 15);
        drawLabel(e.name, x, y + 21, color);
      }
      ctx.restore();
    }
  }

  function drawShots() {
    for (const s of shots) {
      const u = Math.min(1, s.t / s.dur);
      ctx.save();
      ctx.shadowColor = s.color; ctx.shadowBlur = 14 + s.power * 18;
      if (s.form === "projectile") {
        const p = shotPos(s, u);
        ctx.fillStyle = s.color; ctx.globalAlpha = 0.5;
        ellipse(p.x, p.y, s.size * 0.6, s.size * 0.6); ctx.fill();
        ctx.globalAlpha = 1;
        drawIcon(s.icon, p.x, p.y, s.size);
      } else if (s.form === "beam") {
        const env = Math.sin(Math.PI * u);
        const reach = Math.min(1, u / 0.3);
        ctx.strokeStyle = s.color; ctx.lineCap = "round";
        ctx.lineWidth = (5 + s.power * 12) * env;
        ctx.beginPath(); ctx.moveTo(s.from.x, s.from.y);
        ctx.lineTo(lerp(s.from.x, s.to.x, reach), lerp(s.from.y, s.to.y, reach)); ctx.stroke();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = (1.5 + s.power * 3) * env;
        ctx.stroke();
        if (u > 0.3) drawIcon(s.icon, s.to.x, s.to.y - 6, s.size * env);
      } else if (s.form === "rain") {
        for (let i = 0; i < 6; i++) {
          const du = Math.min(1, Math.max(0, (u - i * 0.07) / 0.55));
          if (du <= 0 || du >= 1) continue;
          drawIcon(s.icon, s.to.x + (i - 2.5) * 13 - s.dir * 18 * (1 - du), lerp(-14, s.to.y + 12, du), s.size * 0.72);
        }
      } else if (s.form === "barrier") {
        const grow = Math.min(1, u / 0.5);
        ctx.globalAlpha = u > 0.8 ? (1 - u) * 5 : 1;
        drawIcon(s.icon, s.chest.x + s.dir * 46, ground - 46 * grow, s.size * (0.5 + grow));
      } else if (s.form === "aura") {
        ctx.strokeStyle = s.color; ctx.lineWidth = 3; ctx.globalAlpha = 1 - u;
        ellipse(s.chest.x, s.chest.y, 20 + u * 34, 30 + u * 40); ctx.stroke();
        ctx.globalAlpha = Math.sin(Math.PI * u);
        drawIcon(s.icon, s.chest.x, s.chest.y - 50 - u * 26, s.size);
      } else if (s.form === "trap") {
        ctx.strokeStyle = s.color; ctx.lineWidth = 2.5; ctx.globalAlpha = Math.sin(Math.PI * u);
        ctx.setLineDash([5, 4]); ctx.lineDashOffset = t * 40;
        ellipse(s.to.x, ground + 2, 34 * Math.min(1, u * 2), 9 * Math.min(1, u * 2)); ctx.stroke();
        ctx.setLineDash([]);
        drawIcon(s.icon, s.to.x, ground - 16 - Math.sin(Math.PI * u) * 14, s.size);
      } else if (s.form === "fizzle") {
        ctx.globalAlpha = 1 - u;
        drawIcon("💨", s.from.x + s.dir * u * 18, s.from.y - u * 30, 24);
      }
      ctx.restore();
    }
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake) * 0.6);
    drawBackdrop();
    drawWizard(actors.player);
    drawWizard(actors.enemy, actors.enemy.down > 0.1 ? 0 : scene.enemyCharge);
    drawEffects();
    ctx.globalCompositeOperation = "lighter";
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ellipse(p.x, p.y, p.size, p.size); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    drawShots();
    for (const f of floats) {
      const rise = Math.min(1, f.t / 0.25);
      ctx.globalAlpha = f.t > 0.9 ? Math.max(0, (1.3 - f.t) / 0.4) : 1;
      ctx.font = `700 ${f.size * (0.6 + rise * 0.4)}px ${FONT}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      const y = f.y - f.t * 22;
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(13,11,30,.95)";
      ctx.strokeText(f.text, f.x, y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, y);
      if (f.sub) drawLabel(f.sub, f.x, y + f.size * 0.75, f.color);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
  }

  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (W > 0) {
      scene.onTick?.(dt);
      update(dt);
      draw();
    }
    requestAnimationFrame(frame);
  }
  resize();
  requestAnimationFrame(frame);
  return scene;
}
