/** Serializes autosave and navigation; newer drafts never inherit an older save's success. */
export class AnswerSaveQueue<T> {
  private pending = new Map<string, T>();
  private running: Promise<boolean> | null = null;
  private disposed = false;

  constructor(
    private revision: number,
    private readonly send: (id: string, value: T, revision: number) => Promise<number>,
    private readonly onState: (
      state: 'idle' | 'saving' | 'saved' | 'failed',
      error?: unknown,
    ) => void,
  ) {}

  get dirty(): boolean {
    return this.pending.size > 0 || this.running !== null;
  }

  enqueue(id: string, value: T): void {
    this.pending.set(id, value);
    this.onState('idle');
  }

  flush(): Promise<boolean> {
    if (this.disposed) return Promise.resolve(false);
    if (this.running) return this.running;
    if (!this.pending.size) return Promise.resolve(true);
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    this.disposed = true;
    this.pending.clear();
  }

  private async drain(): Promise<boolean> {
    this.onState('saving');
    while (this.pending.size && !this.disposed) {
      const [id, value] = this.pending.entries().next().value!;
      try {
        this.revision = await this.send(id, value, this.revision);
      } catch (error) {
        if (!this.disposed) this.onState('failed', error);
        return false;
      }
      if (this.pending.get(id) === value) this.pending.delete(id);
    }
    if (this.disposed) return false;
    this.onState('saved');
    return true;
  }
}
