// 연습 모드: API 키가 없을 때 쓰는 단순 규칙 판정.
// 글을 이해하지 못하고 길이·낱말 수·속성 낱말만 본다. 진짜 판정은 lib/judge.js의 AI가 한다.
import { MAX_PLAYER_DAMAGE } from "../public/rivals.js";

const KEYWORDS = {
  fire: ["불", "화염", "용암", "태양", "열", "폭발"],
  ice: ["얼음", "서리", "눈", "냉기", "빙"],
  lightning: ["번개", "벼락", "전기", "천둥"],
  water: ["물", "파도", "비", "강", "바다", "안개"],
  earth: ["땅", "돌", "바위", "모래", "지진", "흙"],
  wind: ["바람", "돌풍", "폭풍", "회오리"],
  light: ["빛", "광", "섬광", "별"],
  shadow: ["그림자", "어둠", "암흑"],
  nature: ["나무", "덩굴", "꽃", "뿌리", "숲"],
  time: ["시간", "과거", "미래"],
  mind: ["환영", "환상", "정신", "꿈", "거울"],
};
const DEFENSE = ["벽", "방패", "숨", "막", "피한", "보호", "결계"];
const HEAL = ["치유", "회복", "치료"];
const CHEAT = ["즉사", "무조건", "체력을 0", "이긴다", "승리한다"];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function mockJudge(req) {
  const s = req.spell;
  const words = new Set(s.split(/\s+/).filter(Boolean));
  const elements = Object.entries(KEYWORDS)
    .filter(([, ks]) => ks.some((k) => s.includes(k))).map(([e]) => e);
  const repeated = req.pastSpells.includes(s);
  const cheat = CHEAT.some((k) => s.includes(k));
  const defensive = DEFENSE.some((k) => s.includes(k));
  const healing = HEAL.some((k) => s.includes(k));

  let creativity = 2 + Math.min(4, Math.floor(words.size / 3)) + Math.min(3, elements.length);
  if (req.effects.some((e) => s.includes(e.name))) creativity += 2;
  if (repeated) creativity -= 4;
  if (cheat) creativity = 1;
  creativity = Math.max(1, Math.min(10, creativity));
  const logic = cheat ? 1 : Math.min(10, 4 + elements.length + (words.size > 4 ? 2 : 0));

  const power = (creativity + logic) / 20;
  const damage = cheat ? 0 : Math.round(MAX_PLAYER_DAMAGE * power * (defensive ? 0.4 : 1));
  const enemyDamage = Math.round(
    req.rival.maxDamage * (0.5 + Math.random() * 0.5) * (defensive ? 0.3 : 1) * (1 - power * 0.4),
  );

  const effects = req.effects.map((e) => ({ ...e, turns: e.turns - 1 }));
  if (defensive && !cheat) effects.push({ owner: "player", name: "방어 마법", turns: 2 });

  return {
    player: {
      narration: cheat
        ? "감당할 수 없는 주문에 마력이 역류한다. 지팡이 끝에서 힘없는 연기만 피어오른다."
        : `당신의 주문이 결투장을 가른다. ${defensive ? "마력이 몸을 감싸 방어막이 된다." : `${req.rival.name}이(가) 휘청이며 물러선다.`}`,
      creativity, logic, damage,
      heal: healing ? 10 : 0,
      element: elements[0] ?? "arcane",
      comment: repeated
        ? "같은 수는 두 번 통하지 않아요."
        : "연습 모드: 낱말 수와 속성만 보고 매긴 점수예요.",
    },
    enemy: {
      spell: pick(["작은 불꽃을 날린다", "돌멩이를 띄워 던진다", "차가운 바람을 불어 보낸다"]),
      narration: defensive
        ? "상대의 주문이 당신의 방어 마법에 부딪혀 흩어진다."
        : "상대의 주문이 당신의 어깨를 스치고 지나간다.",
      damage: enemyDamage,
      heal: 0,
      element: pick(["fire", "earth", "wind"]),
    },
    effects,
  };
}
