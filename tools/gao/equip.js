'use strict';
// 「穿最優質的裝備」：把背包裡的裝備分配給英雄。
//
// 兩件事決定了這支不是「按防禦排序就好」：
//   1. 武器吃英雄的型別天賦。英雄身上 sword/hammer/... 那組 0.00～1.10 的數字
//      是該型別的加成倍率，0.00 表示這隻根本不該拿武器（獸型角色）。
//      同一把劍給黑之劍士（1.10）跟給老醫生（0.75）不是同一回事。
//   2. 雙手武器佔掉副手。所以「雙手斧」要跟「單手劍＋盾」整組比，不能各比各的。
//
// 防具不折算，攻／防直接進面板，所以防具上的攻擊欄也要算進去。

// 裝備 type（中文）→ 佔哪一格
const SLOT = {
  單手劍: 'weapon', 細劍: 'weapon', 短刀: 'weapon', 單手錘: 'weapon',
  雙手劍: 'weapon', 太刀: 'weapon', 雙手斧: 'weapon', 長槍: 'weapon',
  盾牌: 'offhand',
  盔甲: 'body', 大衣: 'body',
  頭盔: 'head', 帽子: 'head',
  鎬子: 'tool',
};

// 武器 type（中文）→ 英雄身上的天賦欄位名
const TALENT = {
  單手劍: 'sword', 細劍: 'rapier', 短刀: 'dagger', 單手錘: 'hammer',
  雙手劍: 'thsword', 太刀: 'katana', 雙手斧: 'axe', 長槍: 'spear',
  盾牌: 'shield',
};

const TWO_HANDED = new Set(['雙手劍', '太刀', '雙手斧', '長槍']);

const slotOf = (eq) => SLOT[eq.type] || null;
const talentOf = (hero, eq) => {
  const key = TALENT[eq.type];
  return key ? Number(hero[key]) || 0 : 0;
};

// 一件裝備對某隻英雄值多少。防具的攻擊欄也進面板，所以一起算。
function scoreFor(hero, eq) {
  if (!eq || eq.dur <= 0) return 0;
  const slot = slotOf(eq);
  if (!slot) return 0;
  if (slot === 'weapon') {
    const t = talentOf(hero, eq);
    if (t <= 0) return 0; // 天賦 0 的型別＝這隻不該拿
    return eq.atk * t;
  }
  if (slot === 'offhand') {
    const t = talentOf(hero, eq);
    if (t <= 0) return 0;
    return eq.def * t * 0.8 + eq.atk * 0.5;
  }
  if (slot === 'tool') return eq.atk * 0 + 1; // 工具不參與戰鬥，有就穿
  return eq.def + eq.atk * 0.6 + eq.lck * 0.15;
}

// 已經穿在身上的那件，同分時優先留著。
// 防具的分數跟誰穿無關，不加這一項的話，兩件同級盔甲會在隊員之間互換，
// 每輪雜務都白丟幾次請求，穿完還是一樣的總防禦。
const STICKY = 1.02;

/**
 * 算出「誰該穿哪一件」。
 *
 * @param {Array} heroes  英雄（要有 id 與各型別天賦欄位）
 * @param {Array} equipments /api/equipments 的清單（含 equipped: heroId|null）
 * @param {object} [opts]
 * @param {(hero:object, slot:string)=>number} [opts.priority]
 *        誰先挑。防具的分數跟穿的人無關，所以先後順序全靠這個決定——
 *        不給的話，最好的盔甲會被英雄清單裡排第一個的人拿走，
 *        哪怕那是隻不上場的一等礦工。
 * @returns {Array<{equipmentId:number, heroId:number, name:string, type:string, heroName:string}>}
 *          需要下 equip 的異動；已經穿對的不會出現在裡面。
 */
function planEquipment(heroes, equipments, opts = {}) {
  const priority = opts.priority || (() => 1);
  const usable = equipments.filter((e) => slotOf(e) && e.dur > 0 && e.state !== 2);

  // 貪心：把（英雄, 裝備, 分數）攤平排序，分數高的先卡位。
  // 一格一件、一件一人，先搶先贏。
  const wants = [];
  for (const h of heroes) {
    for (const e of usable) {
      const raw = scoreFor(h, e);
      if (raw <= 0) continue;
      const slot = slotOf(e);
      const w = priority(h, slot);
      if (w <= 0) continue;
      const score = raw * w * (e.equipped === h.id ? STICKY : 1);
      wants.push({ hero: h, eq: e, slot, score });
    }
  }
  wants.sort((a, b) => b.score - a.score);

  const takenEq = new Set();
  const filled = new Map(); // heroId → Set(slot)
  const assign = new Map(); // equipmentId → heroId
  const heroSlots = (id) => {
    if (!filled.has(id)) filled.set(id, new Set());
    return filled.get(id);
  };

  for (const w of wants) {
    if (takenEq.has(w.eq.id)) continue;
    const slots = heroSlots(w.hero.id);
    if (slots.has(w.slot)) continue;
    // 雙手武器佔掉副手；副手已經有東西時，雙手武器就讓給別人
    if (w.slot === 'weapon' && TWO_HANDED.has(w.eq.type) && slots.has('offhand')) continue;
    if (w.slot === 'offhand' && slots.has('weapon2h')) continue;
    slots.add(w.slot);
    if (w.slot === 'weapon' && TWO_HANDED.has(w.eq.type)) {
      slots.add('offhand');
      slots.add('weapon2h');
    }
    takenEq.add(w.eq.id);
    assign.set(w.eq.id, w.hero.id);
  }

  const byId = new Map(heroes.map((h) => [h.id, h]));
  const changes = [];
  for (const [equipmentId, heroId] of assign) {
    const eq = usable.find((e) => e.id === equipmentId);
    if (eq.equipped === heroId) continue; // 已經穿對了
    changes.push({
      equipmentId,
      heroId,
      name: eq.name,
      type: eq.type,
      quality: eq.quality,
      heroName: (byId.get(heroId) || {}).name || String(heroId),
    });
  }
  return changes;
}

module.exports = { planEquipment, scoreFor, slotOf, talentOf, SLOT, TALENT, TWO_HANDED };
