// tests/quietRunner.test.mjs
// Sync reliability: IT saves are handled once things are quiet, one run at a time.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

let QuietRunner;

before(async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hwy-quiet-'));
    const outfile = join(dir, 'out.mjs');
    await build({ entryPoints: [resolve('src/bridge/quietRunner.ts')], bundle: true, format: 'esm', platform: 'node', outfile, logLevel: 'silent' });
    ({ QuietRunner } = await import(pathToFileURL(outfile).href));
    rmSync(dir, { recursive: true, force: true });
});

/** Fake clock: timers fire only when the test advances time. */
function fakeTimers() {
    let now = 0;
    let next = 1;
    const pending = new Map();
    return {
        set(fn, ms) { const h = next++; pending.set(h, { at: now + ms, fn }); return h; },
        clear(h) { pending.delete(h); },
        async advance(ms) {
            now += ms;
            for (const [h, t] of [...pending]) {
                if (t.at <= now) { pending.delete(h); t.fn(); }
            }
            // Let the task's promise chain settle.
            for (let i = 0; i < 10; i++) await Promise.resolve();
        },
    };
}

describe('QuietRunner', () => {
    it('runs once after a burst of calls', async () => {
        const timers = fakeTimers();
        let runs = 0;
        const r = new QuietRunner(async () => { runs++; }, 300, timers);
        for (let i = 0; i < 10; i++) { r.schedule(); await timers.advance(20); }
        assert.equal(runs, 0, 'still waiting while calls keep coming');
        await timers.advance(300);
        assert.equal(runs, 1);
    });

    it('never overlaps runs, and runs again for a call during a run', async () => {
        const timers = fakeTimers();
        let active = 0, maxActive = 0, runs = 0;
        let release;
        const r = new QuietRunner(async () => {
            runs++; active++; maxActive = Math.max(maxActive, active);
            await new Promise(res => { release = res; });
            active--;
        }, 300, timers);
        r.schedule();
        await timers.advance(300);
        assert.equal(runs, 1);
        r.schedule();                 // arrives during the run
        await timers.advance(1000);
        assert.equal(runs, 1, 'waits for the first run to finish');
        release();
        await timers.advance(0);
        await timers.advance(300);
        assert.equal(runs, 2);
        release();
        await timers.advance(0);
        assert.equal(maxActive, 1);
    });

    it('a failing run does not stop later runs', async () => {
        const timers = fakeTimers();
        let runs = 0;
        const original = console.error;
        console.error = () => {};
        const r = new QuietRunner(async () => { runs++; throw new Error('boom'); }, 300, timers);
        r.schedule(); await timers.advance(300);
        r.schedule(); await timers.advance(300);
        console.error = original;
        assert.equal(runs, 2);
    });

    it('stop cancels a waiting run', async () => {
        const timers = fakeTimers();
        let runs = 0;
        const r = new QuietRunner(async () => { runs++; }, 300, timers);
        r.schedule();
        r.stop();
        r.schedule();
        await timers.advance(1000);
        assert.equal(runs, 0);
    });
});
