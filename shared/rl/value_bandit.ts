/** Small persistent value estimator for choices whose reward arrives later. */
export class ValueBandit<Key extends string> {
  private readonly values = new Map<Key, number>();
  private previous: Key | null = null;
  private reward = 0;

  addReward(value: number): void { this.reward += value; }

  choose(keys: readonly Key[], exploratory: boolean, random = Math.random): Key {
    this.update(0.16, 20);
    const key = exploratory ? keys[Math.floor(random() * keys.length)] : keys.reduce((best, candidate) => (
      (this.values.get(candidate) ?? 0) > (this.values.get(best) ?? 0) ? candidate : best
    ));
    this.previous = key;
    this.reward = 0;
    return key;
  }

  finish(reward: number, rate: number, limit: number): void { this.reward += reward; this.update(rate, limit); }
  value(key: Key): number { return this.values.get(key) ?? 0; }
  best(keys: readonly Key[]): Key { return keys.reduce((best, candidate) => (
    this.value(candidate) > this.value(best) ? candidate : best
  )); }
  entries(): Array<[Key, number]> { return [...this.values.entries()]; }
  restore(entries: readonly [Key, number][]): void { this.values.clear(); for (const [key, value] of entries) if (Number.isFinite(value)) this.values.set(key, value); }

  private update(rate: number, limit: number): void {
    if (!this.previous) return;
    const current = this.value(this.previous);
    const reward = Math.max(-limit, Math.min(limit, this.reward));
    this.values.set(this.previous, current + rate * (reward - current));
    this.previous = null;
    this.reward = 0;
  }
}
