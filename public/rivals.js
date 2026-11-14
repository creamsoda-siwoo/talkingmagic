// 결투 상대 목록과 공용 수치. 서버(판정)와 클라이언트(화면)가 함께 쓴다.
export const RIVALS = [
  {
    id: "pip",
    name: "견습 마법사 핍",
    hp: 70,
    maxDamage: 12,
    weakness: ["mind", "shadow"],
    persona:
      "마법 학교 1학년. 겁이 많고 주문을 자주 더듬는다. 불꽃 튀기기, 물방울, 작은 돌멩이 같은 서툰 기초 마법을 쓴다. 가끔 주문이 엉뚱하게 빗나간다. 무서운 환영과 어둠에 특히 약하다.",
  },
  {
    id: "evelyn",
    name: "서리 마녀 이벨린",
    hp: 100,
    maxDamage: 18,
    weakness: ["fire", "light"],
    persona:
      "차갑고 우아한 얼음 마법의 대가. 말수가 적고 상대를 얕본다. 얼음, 눈보라, 서리, 거울 같은 냉기 마법을 정교하게 쓴다. 불과 눈부신 빛에는 약점을 보인다.",
  },
  {
    id: "morgath",
    name: "대마법사 모르가스",
    hp: 130,
    maxDamage: 24,
    weakness: ["light", "nature"],
    persona:
      "수백 년을 산 교활한 대마법사. 상대의 주문을 읽고 역이용하며, 그림자·시간·환영 등 모든 계열을 다룬다. 뻔한 공격은 여유롭게 받아넘기지만, 예상 밖의 기발한 수에는 진심으로 당황한다. 오래 어둠에 머문 탓에 맑은 빛과 살아 있는 자연의 힘에 약하다.",
  },
];

export const PLAYER_MAX_HP = 100;
export const MAX_PLAYER_DAMAGE = 32; // 내성·약점 적용 전
export const MAX_HEAL = 18;
export const MAX_SPELL_LENGTH = 200;
export const MAX_NOTES = 3;

// 상대가 같은 속성에 익숙해질 때마다 피해가 줄어든다.
export const RESIST_PER_STACK = 20; // %
export const RESIST_CAP = 60; // %
export const WEAKNESS_BONUS = 1.3;

export const ELEMENT_INFO = {
  fire: { name: "불", icon: "🔥", color: "#ff7a3d" },
  ice: { name: "얼음", icon: "❄️", color: "#8fe3ff" },
  lightning: { name: "번개", icon: "⚡", color: "#ffe94d" },
  water: { name: "물", icon: "💧", color: "#4da3ff" },
  earth: { name: "땅", icon: "🪨", color: "#c79a5b" },
  wind: { name: "바람", icon: "🌪️", color: "#b9f5d8" },
  light: { name: "빛", icon: "✨", color: "#fff3b8" },
  shadow: { name: "그림자", icon: "🌑", color: "#7b5cff" },
  nature: { name: "자연", icon: "🌿", color: "#6fdc6f" },
  arcane: { name: "비전", icon: "🔮", color: "#d07bff" },
  mind: { name: "정신", icon: "🌀", color: "#ff8fd6" },
  time: { name: "시간", icon: "⏳", color: "#9fd0ff" },
  other: { name: "기타", icon: "💫", color: "#ffffff" },
};
export const ELEMENTS = Object.keys(ELEMENT_INFO);

// 주문의 겉모습. 화면 연출을 고른다.
export const FORMS = ["projectile", "beam", "rain", "barrier", "aura", "trap", "fizzle"];
export const MOODS = ["calm", "smug", "surprised", "angry", "scared", "impressed"];
