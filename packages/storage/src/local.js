import { promises as fs, createReadStream } from "node:fs";
import path from "node:path";

// Local-filesystem storage adapter. Object keys are server-generated; we still reject any
// key containing ".." as a defense against path traversal escaping the base directory.
export class LocalStorage {
  constructor(baseDir) {
    this.baseDir = baseDir;
  }

  #resolve(key) {
    if (typeof key !== "string" || key.includes("..")) {
      throw new Error("Invalid object key");
    }
    return path.join(this.baseDir, key);
  }

  async put(key, buffer) {
    const full = this.#resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, buffer);
  }

  getStream(key) {
    return createReadStream(this.#resolve(key));
  }

  async remove(key) {
    await fs.rm(this.#resolve(key), { force: true });
  }
}
