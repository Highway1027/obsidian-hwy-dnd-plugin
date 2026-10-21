// src/bridge/TrackerPaneButton.ts
// Bridge button in IT's tracker pane, without changing IT's code: placed in IT's own icon row
// (next to the player-view eye), because a pane in the sidebar has no header. If IT redraws the
// row the button is put back; if a future IT has no such row, it goes in the pane header instead.

import { App, ExtraButtonComponent, View } from 'obsidian';
import { IT_TRACKER_VIEW_TYPE, findTrackerIconRow } from './itPluginAccess';

export interface BridgeButtonState {
    connected: boolean;
    trackerName: string | null;
}

// IT draws its row shortly after the pane opens; only fall back to the header after this.
const ICON_ROW_WAIT_MS = 3000;

interface PaneButton {
    el: HTMLElement | null;        // element that carries the on/off colour
    icon: HTMLElement | null;      // element that carries the tooltip
    observer: MutationObserver | null;
    fallbackTimer: number | null;
}

export class TrackerPaneButtons {
    private app: App;
    private onClick: () => void;
    private buttons: Map<View, PaneButton> = new Map();
    private state: BridgeButtonState = { connected: false, trackerName: null };

    constructor(app: App, onClick: () => void) {
        this.app = app;
        this.onClick = onClick;
    }

    /** Add the button to IT panes that don't have one yet and show the bridge state on all. */
    refresh(state: BridgeButtonState): void {
        this.state = state;
        const views = this.app.workspace.getLeavesOfType(IT_TRACKER_VIEW_TYPE).map(leaf => leaf.view);

        // Forget panes that were closed.
        for (const [view, button] of [...this.buttons.entries()]) {
            if (!views.includes(view)) {
                this.stop(button);
                this.buttons.delete(view);
            }
        }

        for (const view of views) {
            if (!this.buttons.has(view)) this.buttons.set(view, this.watch(view));
            this.show(this.buttons.get(view)!);
        }
    }

    /** Keep a button in IT's icon row for this pane, also after IT redraws it. */
    private watch(view: View): PaneButton {
        const button: PaneButton = { el: null, icon: null, observer: null, fallbackTimer: null };
        const contentEl: HTMLElement = (view as any).contentEl;

        const place = () => {
            if (button.el?.isConnected) return;
            const row = findTrackerIconRow(contentEl);
            if (!row) return;
            const wrapper = createDiv({ cls: 'hwy-bridge-pane-button' });
            row.prepend(wrapper);
            // Built the way IT builds its own icons, so it looks the same.
            const component = new ExtraButtonComponent(wrapper).setIcon('swords').onClick(() => this.onClick());
            button.el = wrapper;
            button.icon = component.extraSettingsEl;
            this.show(button);
        };

        place();
        button.observer = new MutationObserver(place);
        button.observer.observe(contentEl, { childList: true, subtree: true });

        button.fallbackTimer = window.setTimeout(() => {
            button.fallbackTimer = null;
            if (button.el || typeof (view as any).addAction !== 'function') return;
            // This IT version has no icon row we know: use the pane header (not visible in a sidebar).
            this.stop(button);
            const el = (view as any).addAction('swords', 'Initiative Bridge', () => this.onClick()) as HTMLElement;
            button.el = el;
            button.icon = el;
            this.show(button);
        }, ICON_ROW_WAIT_MS);

        return button;
    }

    private show(button: PaneButton): void {
        if (!button.el || !button.icon) return;
        button.el.toggleClass('hwy-bridge-on', this.state.connected);
        button.el.toggleClass('hwy-bridge-off', !this.state.connected);
        const label = this.state.connected
            ? `Bridge connected${this.state.trackerName ? `: ${this.state.trackerName}` : ''} (click for status)`
            : 'Connect to the webapp';
        button.icon.setAttribute('aria-label', label);
    }

    private stop(button: PaneButton): void {
        button.observer?.disconnect();
        button.observer = null;
        if (button.fallbackTimer !== null) window.clearTimeout(button.fallbackTimer);
        button.fallbackTimer = null;
    }

    /** Remove all buttons (plugin unload). */
    removeAll(): void {
        for (const button of this.buttons.values()) {
            this.stop(button);
            button.el?.remove();
        }
        this.buttons.clear();
    }
}
