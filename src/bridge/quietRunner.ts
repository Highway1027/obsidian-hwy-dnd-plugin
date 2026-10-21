// src/bridge/quietRunner.ts
// Runs a task once changes have stopped for a moment, and never two runs at the same time.

export interface Timers {
    set(fn: () => void, ms: number): number;
    clear(handle: number): void;
}

/**
 * IT fires a save for every small change, and a drag-and-drop fires many in a row. The bridge
 * handles them as one: `schedule()` waits until there were no calls for `delayMs`, then runs
 * the task. A call during a run makes the task run once more afterwards, so runs never
 * overlap and the last change is never missed.
 */
export class QuietRunner {
    private timer: number | null = null;
    private running = false;
    private again = false;
    private stopped = false;

    constructor(
        private task: () => Promise<void>,
        private delayMs: number,
        private timers: Timers,
    ) {}

    get isBusy(): boolean {
        return this.running || this.timer !== null;
    }

    schedule(): void {
        if (this.stopped) return;
        if (this.running) {
            this.again = true;
            return;
        }
        if (this.timer !== null) this.timers.clear(this.timer);
        this.timer = this.timers.set(() => {
            this.timer = null;
            void this.run();
        }, this.delayMs);
    }

    /** Cancel a waiting run and ignore later calls. A run already going finishes. */
    stop(): void {
        this.stopped = true;
        this.again = false;
        if (this.timer !== null) this.timers.clear(this.timer);
        this.timer = null;
    }

    private async run(): Promise<void> {
        this.running = true;
        try {
            await this.task();
        } catch (err) {
            console.error('[Bridge] IT change handling failed:', err);
        } finally {
            this.running = false;
        }
        if (this.again && !this.stopped) {
            this.again = false;
            this.schedule();
        }
    }
}
