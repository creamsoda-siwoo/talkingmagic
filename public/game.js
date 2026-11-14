import { RIVALS, PLAYER_MAX_HP, MAX_SPELL_LENGTH } from "./rivals.js";

const AVATARS = { pip: "🧑‍🎓", evelyn: "🧝‍♀️", morgath: "🧙‍♂️" };
const ELEMENT_COLORS = {
  fire: "#ff7a3d", ice: "#8fe3ff", lightning: "#ffe94d", water: "#4da3ff",
  earth: "#c79a5b", wind: "#b9f5d8", light: "#fff3b8", shadow: "#7b5cff",
  nature: "#6fdc6f", arcane: "#d07bff", mind: "#ff8fd6", time: "#9fd0ff", other: "#ffffff",
};
const HEAL_BETWEEN_DUELS = 40;

const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
  rival: 0, playerHp: PLAYER_MAX_HP, enemyHp: 0, turn: 1,
  effects: [], history: [], pastSpells: [], busy: false,
  best: null, // 이번 도전에서 창의력 점수가 가장 높았던 주문
};

// ---------- 화면 그리기 ----------

function renderHp() {
  const rival = RIVALS[state.rival];
  $("player-hpfill").style.width = `${(state.playerHp / PLAYER_MAX_HP) * 100}%`;
  $("enemy-hpfill").style.width = `${(state.enemyHp / rival.hp) * 100}%`;
  $("player-hptext").textContent = `${state.playerHp} / ${PLAYER_MAX_HP}`;
  $("enemy-hptext").textContent = `${state.enemyHp} / ${rival.hp}`;
}

function renderEffects() {
  const box = $("effects");
  box.replaceChildren(...state.effects.map((e) => {
    const chip = document.createElement("span");
    chip.className = `chip ${e.owner}`;
    chip.textContent = e.name;
    const turns = document.createElement("small");
    turns.textContent = `${e.turns}턴`;
    chip.append(turns);
    return chip;
  }));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function addEntry(node) {
  const log = $("log");
  log.append(node);
  log.scrollTop = log.scrollHeight;
  return node;
}

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

function addTurnEntry({ who, spell, narration, enemy = false }) {
  const entry = el("div", `entry turn${enemy ? " enemy" : ""}`);
  entry.append(el("div", "who", who));
  if (spell) entry.append(el("div", "spell", `“${spell}”`));
  if (narration) entry.append(el("p", "narr", narration));
  return addEntry(entry);
}

async function strike(target, amount, element) {
  const burst = $("burst");
  burst.style.setProperty("--c", ELEMENT_COLORS[element] ?? "#fff");
  burst.className = `burst to-${target}`;
  void burst.offsetWidth; // 애니메이션 다시 시작
  burst.classList.add("go");
  if (amount > 0) {
    const side = $(`${target}-side`);
    side.classList.remove("hit");
    void side.offsetWidth;
    side.classList.add("hit");
    float(target, `-${amount}`, "dmg");
  }
  await sleep(500);
}

function float(target, text, kind) {
  const f = $(`${target}-float`);
  f.textContent = text;
  f.className = "float";
  void f.offsetWidth;
  f.className = `float show ${kind}`;
}

// ---------- 게임 진행 ----------

function startDuel(index) {
  const rival = RIVALS[index];
  Object.assign(state, {
    rival: index, enemyHp: rival.hp, turn: 1,
    effects: [], history: [], pastSpells: [], busy: false,
  });
  $("stage-label").textContent = `${index + 1}번째 결투 · 전체 ${RIVALS.length}번`;
  $("enemy-avatar").textContent = AVATARS[rival.id];
  $("enemy-name").textContent = rival.name;
  $("enemy-side").classList.remove("down");
  $("player-side").classList.remove("down");
  $("log").replaceChildren();
  addEntry(el("div", "entry system", `${rival.name}이(가) 결투장에 들어섭니다. 첫 주문을 적어 보세요.`));
  renderHp();
  renderEffects();
  setBusy(false);
  $("spell-input").focus();
}

function setBusy(busy) {
  state.busy = busy;
  $("cast-btn").disabled = busy;
  $("spell-input").disabled = busy;
  $("cast-btn").textContent = busy ? "판정 중" : "주문 외우기";
}

async function cast(spell) {
  if (state.busy) return;
  setBusy(true);
  const rival = RIVALS[state.rival];

  const playerEntry = addTurnEntry({ who: `${state.turn}턴 · 나`, spell });
  const thinking = addEntry(el("div", "entry thinking", "심판이 주문을 읽는 중"));

  let result;
  try {
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        spell, rival: state.rival, turn: state.turn,
        playerHp: state.playerHp, enemyHp: state.enemyHp,
        effects: state.effects, history: state.history, pastSpells: state.pastSpells,
      }),
    });
    result = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(result.error || "판정에 실패했어요. 다시 시도해 주세요.");
  } catch (err) {
    thinking.remove();
    playerEntry.remove();
    addEntry(el("div", "entry error",
      err instanceof TypeError ? "서버에 닿지 않아요. 연결을 확인하고 다시 시도해 주세요." : err.message));
    $("spell-input").value = spell; // 쓴 주문을 잃지 않게 되돌린다
    updateCounter();
    setBusy(false);
    $("spell-input").focus();
    return;
  }
  thinking.remove();
  $("mode-badge").hidden = result.mode !== "mock";

  // 플레이어 주문 결과
  const { player, enemy } = result;
  playerEntry.append(el("p", "narr", player.narration));
  const verdict = el("div", "verdict");
  const creat = stat("창의력", `${player.creativity}/10`);
  creat.append(meter(player.creativity));
  verdict.append(creat, stat("개연성", `${player.logic}/10`), stat("피해", player.damage, "dmg"));
  if (player.heal > 0) verdict.append(stat("회복", `+${player.heal}`, "heal"));
  playerEntry.append(verdict);
  if (player.comment) playerEntry.append(el("div", "comment", `심판: ${player.comment}`));
  $("log").scrollTop = $("log").scrollHeight;

  if (!state.best || player.creativity > state.best.creativity) {
    state.best = { spell, creativity: player.creativity };
  }

  await strike("enemy", player.damage, player.element);
  state.enemyHp = Math.max(0, state.enemyHp - player.damage);
  if (player.heal > 0) {
    state.playerHp = Math.min(PLAYER_MAX_HP, state.playerHp + player.heal);
    float("player", `+${player.heal}`, "heal");
  }
  renderHp();

  if (state.enemyHp <= 0) {
    if (enemy.narration) addTurnEntry({ who: rival.name, narration: enemy.narration, enemy: true });
    $("enemy-side").classList.add("down");
    state.effects = [];
    renderEffects();
    await sleep(1100);
    return finishDuel(true);
  }

  // 상대의 반격
  await sleep(700);
  const enemyEntry = addTurnEntry({
    who: rival.name, spell: enemy.spell, narration: enemy.narration, enemy: true,
  });
  if (enemy.damage > 0 || enemy.heal > 0) {
    const ev = el("div", "verdict");
    if (enemy.damage > 0) ev.append(stat("받은 피해", enemy.damage, "dmg"));
    if (enemy.heal > 0) ev.append(stat("상대 회복", `+${enemy.heal}`, "heal"));
    enemyEntry.append(ev);
    $("log").scrollTop = $("log").scrollHeight;
  }
  await strike("player", enemy.damage, enemy.element);
  state.playerHp = Math.max(0, state.playerHp - enemy.damage);
  if (enemy.heal > 0) {
    state.enemyHp = Math.min(rival.hp, state.enemyHp + enemy.heal);
    float("enemy", `+${enemy.heal}`, "heal");
  }
  state.effects = result.effects;
  renderHp();
  renderEffects();

  if (state.playerHp <= 0) {
    $("player-side").classList.add("down");
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
  $("spell-input").focus();
}

function finishDuel(won) {
  const rival = RIVALS[state.rival];
  const last = state.rival === RIVALS.length - 1;
  const best = $("overlay-best");
  best.replaceChildren();

  if (won && !last) {
    const healed = Math.min(PLAYER_MAX_HP, state.playerHp + HEAL_BETWEEN_DUELS) - state.playerHp;
    $("overlay-title").textContent = "승리!";
    $("overlay-text").textContent =
      `${rival.name}을(를) ${state.turn}턴 만에 쓰러뜨렸어요. 숨을 고르며 체력을 ${healed} 회복합니다. 다음 상대는 ${RIVALS[state.rival + 1].name}.`;
    $("overlay-btn").textContent = "다음 결투로";
    $("overlay-btn").onclick = () => {
      state.playerHp += healed;
      $("overlay").hidden = true;
      startDuel(state.rival + 1);
    };
  } else {
    $("overlay-title").textContent = won ? "대마법사가 되었습니다" : "패배…";
    $("overlay-text").textContent = won
      ? "세 명의 마법사를 모두 말로 쓰러뜨렸어요. 결투장에 당신의 이름이 새겨집니다."
      : `${rival.name}의 주문에 쓰러졌어요. 전장을 더 엮어 쓰고, 같은 수를 피해 보세요.`;
    if (state.best) {
      best.append(el("small", "", `가장 빛난 주문 · 창의력 ${state.best.creativity}/10`),
        document.createTextNode(`“${state.best.spell}”`));
    }
    $("overlay-btn").textContent = "처음부터 다시";
    $("overlay-btn").onclick = () => {
      state.playerHp = PLAYER_MAX_HP;
      state.best = null;
      $("overlay").hidden = true;
      startDuel(0);
    };
  }
  $("overlay").hidden = false;
  $("overlay-btn").focus();
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
  state.playerHp = PLAYER_MAX_HP;
  state.best = null;
  startDuel(0);
});
