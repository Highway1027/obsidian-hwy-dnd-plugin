// src/bridge/TrackerPaneButton.ts
// Bridge button in the header of IT's tracker pane. Uses Obsidian's own view.addAction,
// so IT's code and layout are not touched.

import { App, View } from 'obsidian';
import { IT_TRACKER_VIEW_TYPE } from './itPluginAccess';

export interface BridgeButtonState {
    connected: boolean;
    trackerName: string | null;
}

export class TrackerPaneButtons {
    private app: App;
    private onClick: () => void;
    private buttons: Map<View, HTMLElement> = new Map();

    constructor(app: App, onClick: () => void) {
        this.app = app;
        this.onClick = onClick;
    }

    /** Add the button to IT panes that don't have one yet and show the bridge state on all. */
    refresh(state: BridgeButtonState): void {
        const views = this.app.workspace.getLeavesOfType(IT_TRACKER_VIEW_TYPE).map(leaf => leaf.view);

        // Forget panes that were closed.
        for (const view of [...this.buttons.keys()]) {
            if (!views.includes(view)) this.buttons.delete(view);
        }

        for (const view of views) {
            if (typeof (view as any).addAction !== 'function') continue;
            let button = this.buttons.get(view);
            if (!button) {
                button = (view as any).addAction('swords', 'Initiative Bridge', () => this.onClick()) as HTMLElement;
                this.buttons.set(view, button);
            }
            this.show(button, state);
        }
    }

    private show(button: HTMLElement, state: BridgeButtonState): void {
        button.toggleClass('hwy-bridge-on', state.connected);
        button.toggleClass('hwy-bridge-off', !state.connected);
        const label = state.connected
            ? `Bridge connected${state.trackerName ? `: ${state.trackerName}` : ''} (click for status)`
            : 'Connect to the webapp';
        button.setAttribute('aria-label', label);
    }

    /** Remove all buttons (plugin unload). */
    removeAll(): void {
        for (const button of this.buttons.values()) button.remove();
        this.buttons.clear();
    }
}
