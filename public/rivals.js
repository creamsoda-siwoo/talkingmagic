// 결투 상대 목록. 서버(판정)와 클라이언트(화면)가 같은 순서를 쓴다.
export const RIVALS = [
  {
    id: "pip",
    name: "견습 마법사 핍",
    hp: 70,
    maxDamage: 12,
    persona:
      "마법 학교 1학년. 겁이 많고 주문을 자주 더듬는다. 불꽃 튀기기, 물방울, 작은 돌멩이 같은 서툰 기초 마법을 쓴다. 가끔 주문이 엉뚱하게 빗나간다.",
  },
  {
    id: "evelyn",
    name: "서리 마녀 이벨린",
    hp: 100,
    maxDamage: 18,
    persona:
      "차갑고 우아한 얼음 마법의 대가. 말수가 적고 상대를 얕본다. 얼음, 눈보라, 서리, 거울 같은 냉기 마법을 정교하게 쓴다. 불과 열에는 약점을 보인다.",
  },
  {
    id: "morgath",
    name: "대마법사 모르가스",
    hp: 130,
    maxDamage: 24,
    persona:
      "수백 년을 산 교활한 대마법사. 상대의 주문을 읽고 역이용하며, 그림자·시간·환영 등 모든 계열을 다룬다. 뻔한 공격은 여유롭게 받아넘기지만, 예상 밖의 기발한 수에는 진심으로 당황한다.",
  },
];

export const PLAYER_MAX_HP = 100;
export const MAX_PLAYER_DAMAGE = 32;
export const MAX_HEAL = 18;
export const MAX_SPELL_LENGTH = 200;

export const ELEMENTS = [
  "fire", "ice", "lightning", "water", "earth", "wind",
  "light", "shadow", "nature", "arcane", "mind", "time", "other",
];
