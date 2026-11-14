import {
  RIVALS, PLAYER_MAX_HP, MAX_SPELL_LENGTH, ELEMENT_INFO, RESIST_PER_STACK, RESIST_CAP,
  EFFECT_SECONDS, BLOCK_COST_SECONDS,
} from "./rivals.js";
import { createScene } from "./scene.js";

const MOOD_FACES = {
  calm: "😐", smug: "😏", surprised: "😲", angry: "😠", scared: "😨", impressed: "🤩",
};
const TIERS = [
  { min: 9, label: "전설의 주문!!", cls: "t4" },
  { min: 7, label: "기발한 주문!", cls: "t3" },
  { min: 4, label: "쓸 만한 주문", cls: "t2" },
  { min: 1, label: "밋밋한 주문", cls: "t1" },
];
const HEAL_BETWEEN_DUELS = 60;
const FIRST_ATTACK_GRACE = 5; // 결투 시작 직후 첫 기본 공격까지 더 주는 시간(초)
const FOG_MISS_CHANCE = 0.5;
const MEMORY_KEY = "talkingmagic.notes";

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const scene = createScene($("scene"));

const state = {
  phase: "idle",   // idle | fight | over
  epoch: 0,        // 결투가 끝나거나 바뀌면 올라간다. 늦게 도착한 판정을 버리는 데 쓴다.
  rival: 0, playerHp: PLAYER_MAX_HP, enemyHp: 0, casts: 1,
  effects: [], history: [], pastSpells: [],
  channeling: false, // 내 주문을 심판이 읽는 중
  resolving: false,  // 판정 결과를 연출하는 중 (이 동안 기본 공격은 멈춘다)
  enemyTimer: 0,     // 상대의 다음 기본 공격까지 남은 초
  sinceLast: 0,      // 지난 주문 이후 흐른 초
  basic: { hits: 0, damage: 0, blocked: 0 }, // 지난 주문 이후 받은 기본 공격
  resist: {}, notes: [], weakFound: [], best: null,
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
  $("player-hpfill").classList.toggle("low", state.playerHp <= PLAYER_MAX_HP * 0.3);
  $("enemy-hpfill").style.width = `${(state.enemyHp / rival.hp) * 100}%`;
  $("player-hptext").textContent = `${state.playerHp} / ${PLAYER_MAX_HP}`;
  $("enemy-hptext").textContent = `${state.enemyHp} / ${rival.hp}`;
}

/** 약점·내성·간파 노트. fresh는 방금 새로 생긴 노트, used는 상대가 방금 써먹은 노트. */
function renderIntel({ fresh = [], used = "" } = {}) {
  $("weak-slot").replaceChildren(...(state.weakFound.length
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
  await sleep(reducedMotion ? 300 : 950);
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

function setCastButton() {
  $("cast-btn").disabled = state.channeling || state.phase !== "fight";
  $("cast-btn").textContent = state.channeling ? "시전 중…" : "주문 외우기";
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

// ---------- 실시간 진행 ----------

/** 매 프레임: 지속 효과의 시간이 흐르고, 상대가 기본 공격을 모은다. */
function tick(dt) {
  if (state.phase !== "fight" || state.resolving) return;
  state.sinceLast += dt;
  for (let i = state.effects.length - 1; i >= 0; i--) {
    state.effects[i].remaining -= dt;
    if (state.effects[i].remaining <= 0) state.effects.splice(i, 1);
  }
  const every = RIVALS[state.rival].basic.every;
  state.enemyTimer -= dt;
  const charge = Math.max(0, Math.min(1, 1 - state.enemyTimer / every));
  scene.enemyCharge = charge;
  $("atk-fill").style.width = `${charge * 100}%`;
  $("atk-fill").parentElement.classList.toggle("soon", charge > 0.8);
  if (state.enemyTimer <= 0) {
    state.enemyTimer = every;
    basicAttack();
  }
}
scene.onTick = tick;

/** 상대의 기본 공격 한 발. 내 방벽이 있으면 막히고, 내게 유리한 날씨면 빗나갈 수 있다. */
async function basicAttack() {
  const epoch = state.epoch;
  const rival = RIVALS[state.rival];
  const [element, icon] = rival.basic.shots[Math.floor(Math.random() * rival.basic.shots.length)];
  const wall = state.effects.find((e) => e.owner === "player" && e.where === "player");
  const cover = state.effects.find((e) => e.owner === "player" && e.where === "field");
  const miss = !wall && Boolean(cover) && Math.random() < FOG_MISS_CHANCE;

  await scene.launch("enemy", { form: "projectile", icon, element, power: 0.15, blocked: Boolean(wall), miss });
  if (epoch !== state.epoch || state.phase !== "fight") return;

  if (wall) {
    wall.remaining -= BLOCK_COST_SECONDS;
    scene.flashEffect(wall);
    scene.float("player", "막음!", { color: "#6fe3a5", size: 16, sub: wall.name });
    state.basic.blocked += 1;
  } else if (miss) {
    scene.float("player", "빗나감", { color: "#a79fc7", size: 15, sub: cover.name });
  } else {
    const [lo, hi] = rival.basic.damage;
    const dmg = lo + Math.floor(Math.random() * (hi - lo + 1));
    state.playerHp = Math.max(0, state.playerHp - dmg);
    state.basic.hits += 1;
    state.basic.damage += dmg;
    scene.hit("player");
    scene.float("player", `-${dmg}`, { size: 18 });
    renderHp();
    if (state.playerHp <= 0) endDuel(false);
  }
}

/** 판정이 준 효과 목록을 실시간 타이머가 달린 효과로 바꾼다. 이미 있던 효과는 남은 시간을 잇는다. */
function mergeEffects(list) {
  return list.map((e) => {
    const total = e.turns * EFFECT_SECONDS;
    const old = state.effects.find((o) => o.name === e.name && o.where === e.where);
    const icon = iconOf(e.icon, "arcane");
    return old
      ? { ...e, icon, remaining: Math.min(old.remaining, total), total: old.total }
      : { ...e, icon, remaining: total, total };
  });
}

function startDuel(index, intro) {
  const rival = RIVALS[index];
  state.epoch += 1;
  Object.assign(state, {
    phase: "fight", rival: index, enemyHp: rival.hp, casts: 1,
    history: [], pastSpells: [], weakFound: [],
    channeling: false, resolving: false,
    enemyTimer: rival.basic.every + FIRST_ATTACK_GRACE, sinceLast: 0,
    basic: { hits: 0, damage: 0, blocked: 0 },
  });
  state.effects.length = 0;
  scene.effects = state.effects;
  scene.reset();
  scene.setRival(rival.id);
  $("stage-label").textContent = `${index + 1}번째 결투 · 전체 ${RIVALS.length}번`;
  $("enemy-name").textContent = rival.name;
  $("banner").hidden = true;
  $("arena").classList.remove("judging");
  setMood("calm", "");
  $("log").replaceChildren();
  addEntry(el("div", "entry system",
    `${rival.name}이(가) 결투장에 들어섭니다. 실시간 전투예요. 주문을 쓰는 동안에도 상대는 공격합니다!`));
  if (intro) addEntry(el("div", "entry system", intro));
  renderHp();
  renderIntel();
  setCastButton();
  $("spell-input").focus();
}

async function requestVerdict(spell) {
  const res = await fetch("/api/judge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      spell, rival: state.rival, turn: state.casts,
      playerHp: Math.max(1, state.playerHp), enemyHp: state.enemyHp,
      effects: state.effects.map((e) => ({
        owner: e.owner, where: e.where, name: e.name, icon: e.icon,
        turns: Math.max(1, Math.ceil(e.remaining / EFFECT_SECONDS)),
      })),
      history: state.history, pastSpells: state.pastSpells,
      resist: state.resist, notes: state.notes,
      sinceLast: Math.round(state.sinceLast),
      basicHits: state.basic.hits, basicBlocked: state.basic.blocked,
    }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(result.error || "판정에 실패했어요. 다시 시도해 주세요.");
  return result;
}

async function cast(spell) {
  if (state.channeling || state.phase !== "fight") return;
  const epoch = state.epoch;
  const stale = () => epoch !== state.epoch;
  const rival = RIVALS[state.rival];
  state.channeling = true;
  setCastButton();

  // 주문을 준비하는 동안 받은 기본 공격을 한 줄로 정리한다.
  const { hits, damage, blocked } = state.basic;
  if (hits || blocked) {
    const parts = [];
    if (hits) parts.push(`기본 공격 ${hits}번 맞음 (-${damage})`);
    if (blocked) parts.push(`${blocked}번 막음`);
    addEntry(el("div", "entry system", `⚔️ 주문을 준비하는 동안: ${parts.join(", ")}`));
  }

  const playerEntry = addTurnEntry({ who: `${state.casts}번째 주문 · 나`, spell });
  scene.setChannel("player", true, spell);
  $("arena").classList.add("judging");
  $("enemy-bubble").hidden = true;
  showBanner("wait", el("span", "orb", "🔮"), document.createTextNode(" 시전 중… 심판이 주문을 읽어요"));

  let result;
  try {
    result = await requestVerdict(spell);
  } catch (err) {
    if (stale()) return;
    playerEntry.remove();
    scene.setChannel("player", false);
    $("banner").hidden = true;
    $("arena").classList.remove("judging");
    addEntry(el("div", "entry error",
      err instanceof TypeError ? "서버에 닿지 않아요. 연결을 확인하고 다시 시도해 주세요." : err.message));
    // 쓴 주문을 잃지 않게 되돌린다 (그사이 새로 쓰기 시작했다면 그대로 둔다)
    if (!$("spell-input").value) {
      $("spell-input").value = spell;
      updateCounter();
    }
    state.channeling = false;
    setCastButton();
    return;
  }
  if (stale()) return; // 판정을 기다리는 사이 쓰러졌다

  state.resolving = true;
  scene.enemyCharge = 0;
  $("atk-fill").style.width = "0%";
  $("arena").classList.remove("judging");
  $("mode-badge").hidden = result.mode !== "mock";
  const { player, enemy } = result;

  // 1) 내 주문: 위력 게이지 → 날아가는 연출 → 맞는 순간
  await showPower(player.creativity);
  if (stale()) return;
  scene.setChannel("player", false);
  const power = (player.creativity + player.logic) / 20;
  await scene.launch("player", {
    form: player.form, icon: iconOf(player.icon, player.element), element: player.element, power,
  });
  $("banner").hidden = true;

  const tags = [];
  if (player.weakHit) tags.push(el("span", "tag weak", "🎯 약점 적중 ×1.3"));
  if (player.resistPct > 0) tags.push(el("span", "tag resist", `🛡️ 내성 -${player.resistPct}%`));
  if (player.damage > 0) {
    scene.hit("enemy", player.damage >= 18);
    scene.float("enemy", `-${player.damage}`, {
      color: player.weakHit ? "#f3c969" : "#ff8f9c",
      size: player.weakHit ? 30 : 20 + power * 8,
      sub: player.weakHit ? "약점!" : player.resistPct > 0 ? `익숙한 속성 -${player.resistPct}%` : "",
    });
  } else if (!["barrier", "aura", "fizzle"].includes(player.form)) {
    scene.float("enemy", "막힘", { color: "#a79fc7", size: 15 });
  }
  state.enemyHp = Math.max(0, state.enemyHp - player.damage);
  if (player.heal > 0) {
    state.playerHp = Math.min(PLAYER_MAX_HP, state.playerHp + player.heal);
    scene.float("player", `+${player.heal}`, { color: "#6fe3a5" });
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
  if (stale()) return;

  if (!state.best || player.creativity > state.best.creativity) {
    state.best = { spell, creativity: player.creativity };
  }

  if (state.enemyHp <= 0) {
    state.notes = result.notes;
    renderIntel();
    if (enemy.narration) {
      const fall = addTurnEntry({ who: rival.name, enemy: true });
      fall.append(el("p", "narr", enemy.narration));
      scrollLog();
    }
    return endDuel(true);
  }

  // 2) 상대의 큰 반격: 표정과 대사 → 연출 → 맞는 순간
  await sleep(450);
  if (stale()) return;
  setMood(enemy.mood, enemy.line);
  const freshNotes = result.notes.filter((n) => !state.notes.includes(n));
  state.notes = result.notes;
  renderIntel({ fresh: freshNotes, used: enemy.exploit });
  await sleep(reducedMotion ? 200 : 650);
  if (stale()) return;

  const enemyEntry = addTurnEntry({ who: rival.name, spell: enemy.spell, enemy: true });
  await scene.launch("enemy", {
    form: enemy.form, icon: iconOf(enemy.icon, enemy.element), element: enemy.element,
    power: 0.3 + 0.7 * (enemy.damage / rival.maxDamage),
  });
  if (stale()) return;
  if (enemy.damage > 0) {
    scene.hit("player", enemy.damage >= 12);
    scene.float("player", `-${enemy.damage}`, { size: 22 });
  } else if (!["barrier", "aura", "fizzle"].includes(enemy.form)) {
    scene.float("player", "막아냄!", { color: "#6fe3a5", size: 16 });
  }
  state.playerHp = Math.max(0, state.playerHp - enemy.damage);
  if (enemy.heal > 0) {
    state.enemyHp = Math.min(rival.hp, state.enemyHp + enemy.heal);
    scene.float("enemy", `+${enemy.heal}`, { color: "#6fe3a5" });
  }
  // 같은 배열을 유지해야 장면이 계속 따라 그린다.
  state.effects.splice(0, state.effects.length, ...mergeEffects(result.effects));
  renderHp();

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
  if (stale()) return;

  if (state.playerHp <= 0) return endDuel(false);

  // 다시 실시간으로: 상대가 다음 기본 공격을 모으기 시작한다.
  state.history.push({
    playerSpell: spell, playerResult: player.narration,
    enemySpell: enemy.spell, enemyResult: enemy.narration,
  });
  state.history = state.history.slice(-5);
  state.pastSpells.push(spell);
  state.casts += 1;
  state.sinceLast = 0;
  state.basic = { hits: 0, damage: 0, blocked: 0 };
  state.enemyTimer = rival.basic.every;
  state.resolving = false;
  state.channeling = false;
  setCastButton();
}

/** 결투를 끝낸다. 진행 중이던 판정과 날아가던 공격은 epoch가 바뀌어 무시된다. */
async function endDuel(won) {
  if (state.phase !== "fight") return;
  state.phase = "over";
  state.epoch += 1;
  const epoch = state.epoch;
  scene.setChannel("player", false);
  scene.setDown(won ? "enemy" : "player");
  scene.enemyCharge = 0;
  $("atk-fill").style.width = "0%";
  $("banner").hidden = true;
  $("arena").classList.remove("judging");
  if (won) setMood("scared", "");
  else addEntry(el("div", "entry system", "더는 버티지 못하고 쓰러집니다…"));
  state.effects.length = 0;
  state.channeling = false;
  setCastButton();
  await sleep(1300);
  if (epoch === state.epoch) showResult(won);
}

function showResult(won) {
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
      `${rival.name}을(를) 주문 ${state.casts}번으로 쓰러뜨렸어요. 체력을 ${healed} 회복합니다. 다음 상대 ${next.name}은(는) 이 결투를 지켜보며 노트를 넘겨받았어요.`;
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
      : `${rival.name}에게 쓰러졌어요. 방어 마법으로 기본 공격을 막고, 안 써 본 속성으로 약점을 찾아보세요.`;
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
  // 시전 중에도 다음 주문을 미리 써 둘 수 있다. 외우는 것만 한 번에 하나씩.
  if (!spell || state.channeling || state.phase !== "fight") return;
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
