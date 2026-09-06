'use strict';
// 裝備隨機命名。遊戲限制 12 字元以內的中、英、日文或數字，
// 而且說「名稱似乎也會影響到裝備的好壞」——所以名字不能空著，隨便湊也要湊得像樣。

const PREFIX = [
  '烈風', '幽鐵', '玄岩', '赤炎', '蒼雷', '暗夜', '曙光', '荒原',
  '霜寒', '碧海', '流雲', '斷崖', '孤星', '沉沙', '長夜', '殘照',
  '鐵壁', '磐石', '厚土', '深林', '古木', '青苔', '黃泉', '白晝',
];
const CORE = [
  '護', '守', '鎮', '禦', '衛', '鎧', '盾', '堅',
];
const SUFFIX = {
  armor: ['甲', '重甲', '戰甲', '鎧', '胸甲', '護體'],
  coat: ['衣', '大衣', '披風', '外袍'],
  helmet: ['盔', '頭盔', '面甲'],
  hat: ['帽', '斗笠', '頭巾'],
  shield: ['盾', '巨盾', '護盾'],
  sword: ['劍', '長劍', '利刃'],
  rapier: ['細劍', '刺劍'],
  dagger: ['短刀', '匕首'],
  hammer: ['錘', '戰錘'],
  thsword: ['大劍', '巨劍'],
  katana: ['太刀', '刀'],
  axe: ['斧', '巨斧'],
  spear: ['槍', '長槍'],
};

const pick = (a) => a[Math.floor(Math.random() * a.length)];

// 產一個名字。type 決定後綴，沒對應到就用泛用的。
function randomEquipmentName(type) {
  const tail = pick(SUFFIX[type] || ['具', '器']);
  const head = pick(PREFIX);
  // 一半機率插一個字，讓名字有長有短
  const mid = Math.random() < 0.5 ? pick(CORE) : '';
  const name = `${head}${mid}${tail}`;
  return name.length <= 12 ? name : `${head}${tail}`;
}

module.exports = { randomEquipmentName };
