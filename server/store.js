import fs from 'node:fs';
import path from 'node:path';

// Room actions are synchronous: validation, durable write, then publication.
// A failed validation or disk write never replaces the committed room.
export class RoomStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.data = { version: 1, rooms: {}, sessions: {} };
    if (filePath && fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (data.version !== 1 || !data.rooms || !data.sessions) throw new Error('Unsupported room store');
      this.data = data;
    }
  }

  commit(next) {
    if (this.filePath) {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const temp = `${this.filePath}.tmp`;
      const fd = fs.openSync(temp, 'w', 0o600);
      try {
        fs.writeFileSync(fd, JSON.stringify(next));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, this.filePath);
    }
    this.data = next;
  }

  transaction(callback) {
    const next = structuredClone(this.data);
    const result = callback(next);
    this.commit(next);
    return result;
  }
}
