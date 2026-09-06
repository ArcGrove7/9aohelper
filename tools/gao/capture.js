'use strict';
// 戰報入庫：一行一份戰報的 JSONL，用 report id 去重。
// 這裡只負責「原封不動存下來」，任何統計都留給 build-bestiary.js。

const fs = require('fs');
const path = require('path');

class ReportStore {
  constructor(file) {
    this.file = file;
    this.ids = new Set();
    this.count = 0;
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8');
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (r.id != null) this.ids.add(r.id);
          this.count++;
        } catch { /* 壞行跳過，不讓一行壞掉擋住整批 */ }
      }
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    }
  }

  has(id) { return this.ids.has(id); }

  // 回傳是否真的寫進去（重複的話 false）
  add(report) {
    if (report == null || report.id == null) return false;
    if (this.ids.has(report.id)) return false;
    this.ids.add(report.id);
    this.count++;
    fs.appendFileSync(this.file, JSON.stringify(report) + '\n');
    return true;
  }
}

module.exports = { ReportStore };
