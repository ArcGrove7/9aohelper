'use strict';
// 這一爐該打什麼給誰。
//
// 排序的理由很單純：空著的格子比「舊的換新的」值錢得多。全隊四隻都沒有武器時，
// 再打一件盔甲也只是把防禦從 600 疊到 650，但補上第一把武器是從 0 開始算傷害。
// 所以先補空格，武器又排在防具前面。

const { SLOT, TALENT, TWO_HANDED } = require('./equip.js');

// 英雄天賦欄位 → 鍛造用的 type id
const WEAPON_TYPE = {
  sword: '單手劍', rapier: '細劍', dagger: '短刀', hammer: '單手錘',
  thsword: '雙手劍', katana: '太刀', axe: '雙手斧', spear: '長槍',
};

// 打出來的東西取什麼名字——只是個標籤，不影響數值
const NAME = {
  sword: '長夜之劍', rapier: '細雨', dagger: '短影', hammer: '碎巖',
  thsword: '厚背大劍', katana: '月落', axe: '裂地斧', spear: '長風',
  shield: '磐石盾', armor: '重鎧', coat: '行路大衣', helmet: '鐵盔',
};

// 這隻最適合的武器型別（天賦最高的那個），沒有天賦就是不該拿武器
function bestWeapon(hero) {
  let best = null;
  for (const key of Object.keys(WEAPON_TYPE)) {
    const t = Number(hero[key]) || 0;
    if (t <= 0) continue;
    if (!best || t > best.talent) best = { key, talent: t, cname: WEAPON_TYPE[key] };
  }
  return best;
}

/**
 * 挑一件要打的東西。
 * @param {Array} heroes 全部英雄（含 selected 與天賦欄位）
 * @param {Array} equipments /api/equipments 清單（equipped 是穿在誰身上）
 * @returns {{type:string, name:string, forName:string, reason:string}|null}
 */
function planForgeTarget(heroes, equipments) {
  // 只替「會上場的人」打裝備：進了隊伍的，或等級夠高不是純打工仔的
  const fighters = heroes.filter((h) => h.selected);
  if (!fighters.length) return null;

  const wornBy = new Map(); // heroId → Set(slot)
  for (const e of equipments) {
    if (e.equipped == null) continue;
    const slot = SLOT[e.type];
    if (!slot) continue;
    if (!wornBy.has(e.equipped)) wornBy.set(e.equipped, new Set());
    wornBy.get(e.equipped).add(slot);
    if (TWO_HANDED.has(e.type)) wornBy.get(e.equipped).add('offhand');
  }
  const has = (h, slot) => (wornBy.get(h.id) || new Set()).has(slot);

  // 1. 沒武器的先給武器
  for (const h of fighters) {
    const w = bestWeapon(h);
    if (w && !has(h, 'weapon')) {
      return { type: w.key, name: NAME[w.key], forName: h.name, reason: `${h.name} 沒有武器（${w.cname} 天賦 ${w.talent}）` };
    }
  }
  // 2. 沒盔甲的給盔甲
  for (const h of fighters) {
    if (!has(h, 'body')) {
      return { type: 'armor', name: NAME.armor, forName: h.name, reason: `${h.name} 沒有盔甲` };
    }
  }
  // 3. 沒頭盔的給頭盔
  for (const h of fighters) {
    if (!has(h, 'head')) {
      return { type: 'helmet', name: NAME.helmet, forName: h.name, reason: `${h.name} 沒有頭盔` };
    }
  }
  // 4. 單手武器的人補一面盾
  for (const h of fighters) {
    const w = bestWeapon(h);
    const oneHanded = w && !TWO_HANDED.has(w.cname);
    if (oneHanded && (Number(h.shield) || 0) > 0 && !has(h, 'offhand')) {
      return { type: 'shield', name: NAME.shield, forName: h.name, reason: `${h.name} 副手是空的` };
    }
  }
  // 5. 格子都滿了：繼續打主力的盔甲，換掉舊的那件
  const tank = fighters.slice().sort((a, b) => (b.fullHp || 0) - (a.fullHp || 0))[0];
  return { type: 'armor', name: NAME.armor, forName: tank.name, reason: '格子都滿了，繼續換更好的盔甲' };
}

module.exports = { planForgeTarget, bestWeapon, WEAPON_TYPE };
