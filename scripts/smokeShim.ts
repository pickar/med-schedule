// 仅用于 T01 烟测：在 Node 环境模拟 localStorage。不参与 src 构建。
class MemoryStorage {
  private map = new Map<string, string>();

  get length(): number {
    return this.map.size;
  }

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }

  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }

  dump(): Record<string, string> {
    return Object.fromEntries(this.map.entries());
  }
}

export const memoryStorage = new MemoryStorage();
(globalThis as unknown as { localStorage: unknown }).localStorage = memoryStorage;
