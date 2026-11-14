import {
  RIVALS, PLAYER_MAX_HP, MAX_SPELL_LENGTH, ELEMENT_INFO, RESIST_PER_STACK, RESIST_CAP,
} from "./rivals.js";

const AVATARS = { pip: "🧑‍🎓", evelyn: "🧝‍♀️", morgath: "🧙‍♂️" };
const MOOD_FACES = {
  calm: "😐", smug: "😏", surprised: "😲", angry: "😠", scared: "😨", impressed: "🤩",
};
const TIERS = [
  { min: 9, label: "전설의 주문!!", cls: "t4" },
  { min: 7, label: "기발한 주문!", cls: "t3" },
  { min: 4, label: "쓸 만한 주문", cls: "t2" },
  { min: 1, label: "밋밋한 주문", cls: "t1" },
];
const HEAL_BETWEEN_DUELS = 40;
const MEMORY_KEY = "talkingmagic.notes";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  rival: 0, playerHp: PLAYER_MAX_HP, enemyHp: 0, turn: 1,
  effects: [], history: [], pastSpells: [], busy: false,
  resist: {},      // 상대가 익숙해진 속성 → 내가 쓴 횟수
  notes: [],       // 상대가 나에 대해 적은 간파 노트
  weakFound: [],   // 내가 찾아낸 상대의 약점 속성
  best: null,      // 이번 도전에서 창의력 점수가 가장 높았던 주문
};

// 상대의 기억은 브라우저에 남아 다음 도전으로 이어진다.
const memory = {
  load() {
    try { return JSON.parse(localStorage.getItem(MEMORY_KEY)) ?? []; } catch { return []; }
  },
  save(notes) {
    try { localStorage.setItem(MEMORY_KEY, JSON.stringify(notes)); } catch { /* 저장 불가 환경 */ }
  },
  clear() {
    try { localStorage.removeItem(MEMORY_KEY); } catch { /* 저장 불가 환경 */ }
  },
};

// ---------- 작은 도우미 ----------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/** AI가 준 아이콘에서 이모지 하나만 쓴다. 글자가 섞였으면 속성 기본 아이콘으로 바꾼다. */
function iconOf(raw, element) {
  const fallback = ELEMENT_INFO[element]?.icon ?? "✨";
  const text = String(raw ?? "").trim();
  if (!text || /[\w<>&가-힣]/.test(text)) return fallback;
  if (typeof Intl.Segmenter === "function") {
    const first = new Intl.Segmenter().segment(text)[Symbol.iterator]().next().value;
    return first?.segment ?? fallback;
  }
  return text;
}

function scrollLog() {
  $("log").scrollTop = $("log").scrollHeight;
}

function addEntry(node) {
  $("log").append(node);
  scrollLog();
  return node;
}

async function typeInto(node, text) {
  if (reducedMotion) { node.textContent = text; return; }
  const step = Math.max(1, Math.ceil(text.length / 40));
  for (let i = step; i < text.length; i += step) {
    node.textContent = text.slice(0, i);
    scrollLog();
    await sleep(16);
  }
  node.textContent = text;
  scrollLog();
}

// ---------- 화면 그리기 ----------

function renderHp() {
  const rival = RIVALS[state.rival];
  $("player-hpfill").style.width = `${(state.playerHp / PLAYER_MAX_HP) * 100}%`;
  $("enemy-hpfill").style.width = `${(state.enemyHp / rival.hp) * 100}%`;
  $("player-hptext").textContent = `${state.playerHp} / ${PLAYER_MAX_HP}`;
  $("enemy-hptext").textContent = `${state.enemyHp} / ${rival.hp}`;
}

const OWNER_LABEL = { player: "내게 유리", enemy: "상대에게 유리", field: "중립" };

/** 전장에 남은 효과를 실제 위치(내 쪽·가운데·상대 쪽)에 세워 둔다. */
function renderEffects() {
  const zones = { player: [], field: [], enemy: [] };
  for (const e of state.effects) {
    const token = el("div", `token ${e.owner}`);
    token.title = `${e.name} · ${OWNER_LABEL[e.owner]} · ${e.turns}턴 남음`;
    token.append(el("span", "ico", iconOf(e.icon, "arcane")), el("span", "lbl", e.name));
    const pips = el("span", "pips");
    for (let i = 0; i < e.turns; i++) pips.append(el("i"));
    token.append(pips);
    zones[e.where].push(token);
  }
  for (const where of Object.keys(zones)) $(`fx-${where}`).replaceChildren(...zones[where]);
}

/** 약점·내성·간파 노트. fresh는 방금 새로 생긴 노트, used는 상대가 방금 써먹은 노트. */
function renderIntel({ fresh = [], used = "" } = {}) {
  const weak = $("weak-slot");
  weak.replaceChildren(...(state.weakFound.length
    ? state.weakFound.map((e) => el("span", "pill weak", `${ELEMENT_INFO[e].icon} ${ELEMENT_INFO[e].name}`))
    : [el("span", "empty", "❓ 아직 못 찾음")]));

  const stacks = Object.entries(state.resist).filter(([, n]) => n > 0);
  $("resist-slot").replaceChildren(...(stacks.length
    ? stacks.map(([e, n]) => {
        const pill = el("span", "pill resist", `${ELEMENT_INFO[e].icon} `);
        pill.append(el("b", "", `-${Math.min(RESIST_CAP, n * RESIST_PER_STACK)}%`));
        pill.title = `${ELEMENT_INFO[e].name} 속성을 ${n}번 써서 상대가 익숙해졌어요.`;
        return pill;
      })
    : [el("span", "empty", "없음")]));

  $("notes-slot").replaceChildren(...(state.notes.length
    ? state.notes.map((n) =>
        el("span", `pill note${n === used ? " used" : fresh.includes(n) ? " new" : ""}`, n))
    : [el("span", "empty", "상대가 아직 나를 몰라요")]));
}

function setActive(side) {
  $("player-side").classList.toggle("active", side === "player");
  $("enemy-side").classList.toggle("active", side === "enemy");
}

function showBanner(className, ...children) {
  const banner = $("banner");
  banner.className = `banner ${className}`;
  banner.replaceChildren(...children);
  banner.hidden = false;
}

/** 창의력 점수를 위력 게이지로 보여 준다. */
async function showPower(creativity) {
  const tier = TIERS.find((t) => creativity >= t.min);
  const gauge = el("div", "gauge");
  const fill = el("i");
  gauge.append(fill);
  showBanner(tier.cls, el("div", "label", `${tier.label} · 창의력 ${creativity}`), gauge);
  void fill.offsetWidth;
  fill.style.width = `${creativity * 10}%`;
  await sleep(reducedMotion ? 300 : 1100);
}

function setMood(mood, line) {
  const face = $("enemy-mood");
  face.textContent = MOOD_FACES[mood] ?? "";
  face.classList.remove("pop");
  void face.offsetWidth;
  face.classList.add("pop");
  const bubble = $("enemy-bubble");
  bubble.hidden = !line;
  bubble.textContent = line ?? "";
}

function float(target, text, kind, sub) {
  const f = $(`${target}-float`);
  f.replaceChildren(document.createTextNode(text));
  if (sub) f.append(el("small", "", sub));
  f.className = "float";
  void f.offsetWidth;
  f.className = `float show ${kind}`;
}

// ---------- 주문 연출 ----------

function centerOf(node) {
  const a = $("arena").getBoundingClientRect();
  const r = node.getBoundingClientRect();
  return { x: r.left - a.left + r.width / 2, y: r.top - a.top + r.height / 2 };
}

function spawn(className, text, x, y, size) {
  const node = el("span", `fx ${className}`, text);
  node.style.fontSize = `${size}px`;
  node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
  $("fx-layer").append(node);
  return node;
}

const at = (x, y, extra = "") => `translate(${x}px, ${y}px) translate(-50%, -50%) ${extra}`;

/** 주문의 겉모습(form)에 따라 시전자에서 대상까지 눈에 보이는 연출을 한다. */
async function playSpell(caster, { form, icon, element, power }) {
  if (reducedMotion) return;
  const target = caster === "player" ? "enemy" : "player";
  const from = centerOf($(`${caster}-avatar`));
  const to = centerOf($(`${target}-avatar`));
  const color = ELEMENT_INFO[element]?.color ?? "#fff";
  const size = 24 + 26 * power;
  const dir = Math.sign(to.x - from.x);
  const glow = `drop-shadow(0 0 ${6 + 10 * power}px ${color})`;
  const done = [];
  const run = (node, frames, opts) => {
    node.style.filter = glow;
    const anim = node.animate(frames, { fill: "forwards", easing: "ease-in", ...opts });
    done.push(anim.finished.then(() => node.remove()));
  };

  if (form === "beam") {
    const beam = el("span", "fx beam");
    const width = Math.abs(to.x - from.x);
    beam.style.width = `${width}px`;
    beam.style.height = `${6 + 12 * power}px`;
    beam.style.background = `linear-gradient(${dir > 0 ? 90 : 270}deg, transparent, ${color}, #fff)`;
    beam.style.transformOrigin = dir > 0 ? "left center" : "right center";
    const left = Math.min(from.x, to.x);
    $("fx-layer").append(beam);
    run(beam, [
      { transform: `translate(${left}px, ${from.y}px) scaleX(0)`, opacity: 1 },
      { transform: `translate(${left}px, ${from.y}px) scaleX(1)`, opacity: 1, offset: 0.5 },
      { transform: `translate(${left}px, ${from.y}px) scaleX(1)`, opacity: 0 },
    ], { duration: 520 });
    const tip = spawn("", icon, to.x, to.y, size);
    run(tip, [
      { transform: at(to.x, to.y, "scale(0)"), opacity: 0, offset: 0 },
      { transform: at(to.x, to.y, "scale(0)"), opacity: 0, offset: 0.45 },
      { transform: at(to.x, to.y, "scale(1.5)"), opacity: 1, offset: 0.7 },
      { transform: at(to.x, to.y, "scale(1)"), opacity: 0, offset: 1 },
    ], { duration: 620 });
  } else if (form === "rain") {
    for (let i = 0; i < 6; i++) {
      const x = to.x + (i - 2.5) * 13;
      const drop = spawn("", icon, x, -20, size * 0.7);
      run(drop, [
        { transform: at(x + dir * -20, -24), opacity: 0 },
        { transform: at(x + dir * -10, to.y * 0.4), opacity: 1, offset: 0.4 },
        { transform: at(x, to.y + 6), opacity: 1, offset: 0.9 },
        { transform: at(x, to.y + 10, "scale(1.4)"), opacity: 0 },
      ], { duration: 560, delay: i * 70 });
    }
  } else if (form === "barrier") {
    const x = from.x + dir * 52;
    const wall = spawn("", icon, x, from.y, size * 1.3);
    run(wall, [
      { transform: at(x, from.y + 30, "scale(0)"), opacity: 0 },
      { transform: at(x, from.y, "scale(1.35)"), opacity: 1, offset: 0.45 },
      { transform: at(x, from.y, "scale(1)"), opacity: 1, offset: 0.8 },
      { transform: at(x, from.y, "scale(1)"), opacity: 0 },
    ], { duration: 800, easing: "ease-out" });
  } else if (form === "aura") {
    const ring = el("span", "fx ring");
    ring.style.width = ring.style.height = "70px";
    ring.style.borderColor = color;
    $("fx-layer").append(ring);
    run(ring, [
      { transform: at(from.x, from.y, "scale(.3)"), opacity: 1 },
      { transform: at(from.x, from.y, "scale(1.9)"), opacity: 0 },
    ], { duration: 750, easing: "ease-out" });
    const rise = spawn("", icon, from.x, from.y, size);
    run(rise, [
      { transform: at(from.x, from.y + 10), opacity: 0 },
      { transform: at(from.x, from.y - 20), opacity: 1, offset: 0.4 },
      { transform: at(from.x, from.y - 54), opacity: 0 },
    ], { duration: 800, easing: "ease-out" });
  } else if (form === "trap") {
    const y = to.y + 22;
    const trap = spawn("", icon, to.x, y, size);
    run(trap, [
      { transform: at(to.x, y + 14, "scale(0)"), opacity: 0 },
      { transform: at(to.x, y, "scale(1.4) rotate(-12deg)"), opacity: 1, offset: 0.4 },
      { transform: at(to.x, y, "scale(1.2) rotate(10deg)"), opacity: 1, offset: 0.7 },
      { transform: at(to.x, y, "scale(1)"), opacity: 0 },
    ], { duration: 800, easing: "ease-out" });
  } else if (form === "fizzle") {
    const puff = spawn("", "💨", from.x, from.y, 30);
    run(puff, [
      { transform: at(from.x + dir * 20, from.y, "scale(.4)"), opacity: 1 },
      { transform: at(from.x + dir * 34, from.y - 40, "scale(1.3)"), opacity: 0 },
    ], { duration: 800, easing: "ease-out" });
  } else {
    // projectile: 포물선을 그리며 날아간다
    const shot = spawn("", icon, from.x, from.y, size);
    const midX = (from.x + to.x) / 2;
    run(shot, [
      { transform: at(from.x, from.y, "scale(.4) rotate(0deg)"), opacity: 1 },
      { transform: at(midX, Math.min(from.y, to.y) - 46, `scale(1) rotate(${dir * 180}deg)`), opacity: 1, offset: 0.5 },
      { transform: at(to.x, to.y, `scale(1.25) rotate(${dir * 360}deg)`), opacity: 1 },
    ], { duration: 560 });
  }
  await Promise.all(done);
}

/** 맞는 순간: 속성 색 섬광, 흔들림, 피해 숫자. */
async function impact(target, { amount, element, kind = "dmg", sub, blocked }) {
  if (amount > 0) {
    const burst = $("burst");
    burst.style.setProperty("--c", ELEMENT_INFO[element]?.color ?? "#fff");
    burst.className = `burst to-${target}`;
    void burst.offsetWidth;
    burst.classList.add("go");
    const side = $(`${target}-side`);
    side.classList.remove("hit");
    void side.offsetWidth;
    side.classList.add("hit");
    if (amount >= 20) {
      $("arena").classList.remove("shake");
      void $("arena").offsetWidth;
      $("arena").classList.add("shake");
    }
    float(target, `-${amount}`, kind, sub);
  } else if (blocked) {
    float(target, blocked, "miss");
  }
  await sleep(reducedMotion ? 150 : 600);
}

// ---------- 기록(로그) ----------

function meter(score) {
  const m = el("span", "meter");
  for (let i = 1; i <= 10; i++) m.append(el("i", i <= score ? "on" : ""));
  return m;
}

function stat(label, value, className = "") {
  const s = el("span", `stat ${className}`, `${label} `);
  s.append(el("b", "", value));
  return s;
}

function addTurnEntry({ who, spell, enemy = false }) {
  const entry = el("div", `entry turn${enemy ? " enemy" : ""}`);
  entry.append(el("div", "who", who));
  if (spell) entry.append(el("div", "spell", `“${spell}”`));
  return addEntry(entry);
}

// ---------- 게임 진행 ----------

function startDuel(index, intro) {
  const rival = RIVALS[index];
  Object.assign(state, {
    rival: index, enemyHp: rival.hp, turn: 1,
    effects: [], history: [], pastSpells: [], weakFound: [], busy: false,
  });
  $("stage-label").textContent = `${index + 1}번째 결투 · 전체 ${RIVALS.length}번`;
  $("enemy-avatar").textContent = AVATARS[rival.id];
  $("enemy-name").textContent = rival.name;
  $("enemy-side").classList.remove("down");
  $("player-side").classList.remove("down");
  $("banner").hidden = true;
  setMood("calm", "");
  $("log").replaceChildren();
  addEntry(el("div", "entry system", `${rival.name}이(가) 결투장에 들어섭니다. 첫 주문을 적어 보세요.`));
  if (intro) addEntry(el("div", "entry system", intro));
  renderHp();
  renderEffects();
  renderIntel();
  setBusy(false);
  setActive("player");
  $("spell-input").focus();
}

function setBusy(busy) {
  state.busy = busy;
  $("cast-btn").disabled = busy;
  $("spell-input").disabled = busy;
  $("cast-btn").textContent = busy ? "판정 중" : "주문 외우기";
}

async function requestVerdict(spell) {
  const res = await fetch("/api/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spell, rival: state.rival, turn: state.turn,
      playerHp: state.playerHp, enemyHp: state.enemyHp,
      effects: state.effects, history: state.history, pastSpells: state.pastSpells,
      resist: state.resist, notes: state.notes,
    }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "판정에 실패했어요. 다시 시도해 주세요.");
  return result;
}

async function cast(spell) {
  if (state.busy) return;
  setBusy(true);
  const rival = RIVALS[state.rival];

  const playerEntry = addTurnEntry({ who: `${state.turn}턴 · 나`, spell });
  $("arena").classList.add("judging");
  $("enemy-bubble").hidden = true;
  const orb = el("span", "orb", "🔮");
  showBanner("wait", orb, document.createTextNode(" 심판이 주문을 읽는 중…"));

  let result;
  try {
    result = await requestVerdict(spell);
  } catch (err) {
    playerEntry.remove();
    $("banner").hidden = true;
    $("arena").classList.remove("judging");
    addEntry(el("div", "entry error",
      err instanceof TypeError ? "서버에 닿지 않아요. 연결을 확인하고 다시 시도해 주세요." : err.message));
    $("spell-input").value = spell; // 쓴 주문을 잃지 않게 되돌린다
    updateCounter();
    setBusy(false);
    $("spell-input").focus();
    return;
  }
  $("arena").classList.remove("judging");
  $("mode-badge").hidden = result.mode !== "mock";
  const { player, enemy } = result;

  // 1) 내 주문: 위력 게이지 → 날아가는 연출 → 맞는 순간
  await showPower(player.creativity);
  const power = (player.creativity + player.logic) / 20;
  await playSpell("player", {
    form: player.form, icon: iconOf(player.icon, player.element), element: player.element, power,
  });
  $("banner").hidden = true;

  const tags = [];
  if (player.weakHit) tags.push(el("span", "tag weak", "🎯 약점 적중 ×1.3"));
  if (player.resistPct > 0) tags.push(el("span", "tag resist", `🛡️ 내성 -${player.resistPct}%`));
  const offensive = !["barrier", "aura", "fizzle"].includes(player.form);
  await impact("enemy", {
    amount: player.damage, element: player.element,
    kind: player.weakHit ? "dmg crit" : "dmg",
    sub: player.weakHit ? "약점!" : player.resistPct > 0 ? `익숙한 속성 -${player.resistPct}%` : "",
    blocked: offensive ? "막힘" : "",
  });
  state.enemyHp = Math.max(0, state.enemyHp - player.damage);
  if (player.heal > 0) {
    state.playerHp = Math.min(PLAYER_MAX_HP, state.playerHp + player.heal);
    float("player", `+${player.heal}`, "heal");
  }
  if (player.weakHit && !state.weakFound.includes(player.element)) {
    state.weakFound.push(player.element);
    addEntry(el("div", "entry system",
      `🎯 약점 발견! ${rival.name}은(는) ${ELEMENT_INFO[player.element].name} 속성에 약합니다.`));
  }
  state.resist = result.resist;
  renderHp();
  renderIntel();

  const narr = el("p", "narr");
  playerEntry.append(narr);
  await typeInto(narr, player.narration);
  const verdict = el("div", "verdict");
  const creat = stat("창의력", `${player.creativity}/10`);
  creat.append(meter(player.creativity));
  verdict.append(creat, stat("개연성", `${player.logic}/10`), stat("피해", player.damage, "dmg"));
  if (player.heal > 0) verdict.append(stat("회복", `+${player.heal}`, "heal"));
  verdict.append(...tags);
  playerEntry.append(verdict);
  if (player.comment) playerEntry.append(el("div", "comment", `심판: ${player.comment}`));
  scrollLog();

  if (!state.best || player.creativity > state.best.creativity) {
    state.best = { spell, creativity: player.creativity };
  }

  if (state.enemyHp <= 0) {
    setMood("scared", "");
    if (enemy.narration) {
      const fall = addTurnEntry({ who: rival.name, enemy: true });
      const p = el("p", "narr");
      fall.append(p);
      await typeInto(p, enemy.narration);
    }
    $("enemy-side").classList.add("down");
    state.effects = [];
    state.notes = result.notes;
    renderEffects();
    renderIntel();
    setActive(null);
    await sleep(1100);
    return finishDuel(true);
  }

  // 2) 상대의 반격: 표정과 대사 → 연출 → 맞는 순간
  await sleep(500);
  setActive("enemy");
  setMood(enemy.mood, enemy.line);
  const freshNotes = result.notes.filter((n) => !state.notes.includes(n));
  state.notes = result.notes;
  renderIntel({ fresh: freshNotes, used: enemy.exploit });
  await sleep(reducedMotion ? 200 : 800);

  const enemyEntry = addTurnEntry({ who: rival.name, spell: enemy.spell, enemy: true });
  await playSpell("enemy", {
    form: enemy.form, icon: iconOf(enemy.icon, enemy.element), element: enemy.element,
    power: enemy.damage / rival.maxDamage,
  });
  await impact("player", {
    amount: enemy.damage, element: enemy.element,
    blocked: ["barrier", "aura", "fizzle"].includes(enemy.form) ? "" : "막아냄!",
  });
  state.playerHp = Math.max(0, state.playerHp - enemy.damage);
  if (enemy.heal > 0) {
    state.enemyHp = Math.min(rival.hp, state.enemyHp + enemy.heal);
    float("enemy", `+${enemy.heal}`, "heal");
  }
  state.effects = result.effects;
  renderHp();
  renderEffects();

  const enemyNarr = el("p", "narr");
  enemyEntry.append(enemyNarr);
  await typeInto(enemyNarr, enemy.narration);
  const ev = el("div", "verdict");
  if (enemy.damage > 0) ev.append(stat("받은 피해", enemy.damage, "dmg"));
  if (enemy.heal > 0) ev.append(stat("상대 회복", `+${enemy.heal}`, "heal"));
  if (enemy.exploit) ev.append(el("span", "tag read", `📖 간파당함: ${enemy.exploit}`));
  if (ev.childNodes.length) enemyEntry.append(ev);
  if (freshNotes.length) {
    addEntry(el("div", "entry system", `📖 상대가 노트에 적습니다: “${freshNotes.join("”, “")}”`));
  }
  scrollLog();

  if (state.playerHp <= 0) {
    $("player-side").classList.add("down");
    setActive(null);
    await sleep(1100);
    return finishDuel(false);
  }

  state.history.push({
    playerSpell: spell, playerResult: player.narration,
    enemySpell: enemy.spell, enemyResult: enemy.narration,
  });
  state.pastSpells.push(spell);
  state.turn += 1;
  setBusy(false);
  setActive("player");
  $("spell-input").focus();
}

function finishDuel(won) {
  const rival = RIVALS[state.rival];
  const last = state.rival === RIVALS.length - 1;
  const best = $("overlay-best");
  const learned = $("overlay-notes");
  best.replaceChildren();
  learned.replaceChildren();
  if (state.notes.length) {
    learned.append(el("small", "", "📖 상대가 나에 대해 배운 것"),
      ...state.notes.map((n) => el("span", "pill note", n)));
  }

  if (won && !last) {
    const next = RIVALS[state.rival + 1];
    const healed = Math.min(PLAYER_MAX_HP, state.playerHp + HEAL_BETWEEN_DUELS) - state.playerHp;
    $("overlay-title").textContent = "승리!";
    $("overlay-text").textContent =
      `${rival.name}을(를) ${state.turn}턴 만에 쓰러뜨렸어요. 체력을 ${healed} 회복합니다. 다음 상대 ${next.name}은(는) 이 결투를 지켜보며 노트를 넘겨받았어요.`;
    $("overlay-btn").textContent = "다음 결투로";
    $("overlay-btn").onclick = () => {
      state.playerHp += healed;
      // 다음 상대는 지켜본 만큼만 익숙하다: 내성은 절반만 이어진다.
      state.resist = Object.fromEntries(
        Object.entries(state.resist).map(([e, n]) => [e, Math.floor(n / 2)]).filter(([, n]) => n > 0));
      $("overlay").hidden = true;
      startDuel(state.rival + 1,
        state.notes.length ? "📖 상대는 앞선 결투의 간파 노트를 읽고 왔습니다." : "");
    };
  } else {
    memory.save(state.notes);
    $("overlay-title").textContent = won ? "대마법사가 되었습니다" : "패배…";
    $("overlay-text").textContent = won
      ? "세 명의 마법사를 모두 말로 쓰러뜨렸어요. 결투장에 당신의 이름이 새겨집니다."
      : `${rival.name}의 주문에 쓰러졌어요. 상대가 읽은 내 습관을 뒤집고, 안 써 본 속성으로 약점을 찾아보세요.`;
    if (state.best) {
      best.append(el("small", "", `가장 빛난 주문 · 창의력 ${state.best.creativity}/10`),
        document.createTextNode(`“${state.best.spell}”`));
    }
    $("overlay-btn").textContent = "처음부터 다시";
    $("overlay-btn").onclick = () => {
      $("overlay").hidden = true;
      startRun();
    };
  }
  $("overlay").hidden = false;
  $("overlay-btn").focus();
}

function startRun() {
  state.playerHp = PLAYER_MAX_HP;
  state.best = null;
  state.resist = {};
  state.notes = memory.load().filter((n) => typeof n === "string").slice(0, 3);
  startDuel(0, state.notes.length ? "📖 상대는 지난 도전에서 배운 것을 기억하고 있습니다." : "");
}

// ---------- 입력 ----------

function updateCounter() {
  $("counter").textContent = `${$("spell-input").value.length} / ${MAX_SPELL_LENGTH}`;
}

$("spell-input").maxLength = MAX_SPELL_LENGTH;
$("spell-input").addEventListener("input", updateCounter);
$("spell-input").addEventListener("keydown", (e) => {
  // Enter로 외우기, Shift+Enter로 줄바꿈. 한글 조합 중 Enter는 무시한다.
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    $("spell-form").requestSubmit();
  }
});
$("spell-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const spell = $("spell-input").value.trim();
  if (!spell || state.busy) return;
  $("spell-input").value = "";
  updateCounter();
  cast(spell);
});
$("start-btn").addEventListener("click", () => {
  $("title-screen").hidden = true;
  $("duel-screen").hidden = false;
  startRun();
});
$("memory-line").hidden = memory.load().length === 0;
$("forget-btn").addEventListener("click", () => {
  memory.clear();
  $("memory-line").hidden = true;
});
