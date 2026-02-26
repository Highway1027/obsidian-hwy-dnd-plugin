// src/bridge/BridgeStatusView.ts
// v1 - 26-02-2026 - Bridge status sidebar panel

import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { InitiativeBridgeManager } from './InitiativeBridgeManager';

export const BRIDGE_STATUS_VIEW_TYPE = 'highway-bridge-status';

export class BridgeStatusView extends ItemView {
    private bridgeManager: InitiativeBridgeManager | null = null;
    private refreshInterval: ReturnType<typeof setInterval> | null = null;
    private onConnectCallback: (() => void) | null = null;
    private onDisconnectCallback: (() => void) | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return BRIDGE_STATUS_VIEW_TYPE;
    }

    getDisplayText(): string {
        return 'Initiative Bridge';
    }

    getIcon(): string {
        return 'swords';
    }

    setBridgeManager(manager: InitiativeBridgeManager): void {
        this.bridgeManager = manager;
        this.render();
    }

    setCallbacks(onConnect: () => void, onDisconnect: () => void): void {
        this.onConnectCallback = onConnect;
        this.onDisconnectCallback = onDisconnect;
    }

    async onOpen(): Promise<void> {
        this.render();
        // Auto-refresh every 2 seconds for live stats
        this.refreshInterval = setInterval(() => this.render(), 2000);
    }

    async onClose(): Promise<void> {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    render(): void {
        const container = this.containerEl.children[1];
        if (!container) return;
        container.empty();

        const root = container.createDiv({ cls: 'bridge-status-root' });

        // Styles
        const style = root.createEl('style');
        style.textContent = `
            .bridge-status-root {
                padding: 12px;
                font-size: 13px;
            }
            .bridge-status-header {
                display: flex;
                align-items: center;
                gap: 8px;
                margin-bottom: 16px;
                padding-bottom: 8px;
                border-bottom: 1px solid var(--background-modifier-border);
            }
            .bridge-status-dot {
                width: 10px;
                height: 10px;
                border-radius: 50%;
                flex-shrink: 0;
            }
            .bridge-status-dot.connected { background: #22c55e; box-shadow: 0 0 6px #22c55e88; }
            .bridge-status-dot.disconnected { background: #ef4444; }
            .bridge-status-label {
                font-weight: 600;
                font-size: 14px;
            }
            .bridge-info-grid {
                display: grid;
                grid-template-columns: auto 1fr;
                gap: 4px 12px;
                margin-bottom: 16px;
            }
            .bridge-info-key {
                color: var(--text-muted);
                font-size: 12px;
            }
            .bridge-info-value {
                font-weight: 500;
                font-size: 12px;
            }
            .bridge-action-btn {
                width: 100%;
                padding: 8px 12px;
                border-radius: 6px;
                border: none;
                cursor: pointer;
                font-weight: 600;
                font-size: 13px;
                margin-bottom: 8px;
            }
            .bridge-action-btn.connect {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
            }
            .bridge-action-btn.connect:hover {
                filter: brightness(1.1);
            }
            .bridge-action-btn.disconnect {
                background: var(--background-modifier-border);
                color: var(--text-normal);
            }
            .bridge-action-btn.disconnect:hover {
                background: #ef444433;
                color: #ef4444;
            }
            .bridge-help-section {
                margin-top: 20px;
                padding-top: 12px;
                border-top: 1px solid var(--background-modifier-border);
            }
            .bridge-help-section h4 {
                margin: 0 0 8px 0;
                font-size: 12px;
                color: var(--text-muted);
                text-transform: uppercase;
                letter-spacing: 0.5px;
            }
            .bridge-help-item {
                font-size: 11px;
                color: var(--text-muted);
                margin-bottom: 4px;
                line-height: 1.4;
            }
        `;

        // Connection status header
        const info = this.bridgeManager?.getStatusInfo();
        const connected = info?.connected ?? false;

        const header = root.createDiv({ cls: 'bridge-status-header' });
        header.createDiv({ cls: `bridge-status-dot ${connected ? 'connected' : 'disconnected'}` });
        header.createDiv({ cls: 'bridge-status-label', text: connected ? 'Connected' : 'Disconnected' });

        if (connected && info) {
            // Info grid
            const grid = root.createDiv({ cls: 'bridge-info-grid' });

            const addRow = (key: string, value: string) => {
                grid.createDiv({ cls: 'bridge-info-key', text: key });
                grid.createDiv({ cls: 'bridge-info-value', text: value });
            };

            addRow('Tracker', info.trackerName || 'Unknown');
            addRow('Combatants', String(info.combatantCount));
            addRow('Round', String(info.round));

            // Disconnect button
            const disconnectBtn = root.createEl('button', {
                cls: 'bridge-action-btn disconnect',
                text: '⏹ Disconnect',
            });
            disconnectBtn.addEventListener('click', () => {
                this.onDisconnectCallback?.();
                setTimeout(() => this.render(), 500);
            });
        } else {
            // Connect button
            const hint = root.createDiv({
                cls: 'bridge-help-item',
                attr: { style: 'margin-bottom: 12px;' },
            });
            hint.textContent = 'Connect to a webapp initiative tracker to enable real-time bidirectional sync.';

            const connectBtn = root.createEl('button', {
                cls: 'bridge-action-btn connect',
                text: '⚔ Connect Bridge',
            });
            connectBtn.addEventListener('click', () => {
                this.onConnectCallback?.();
            });
        }

        // Quick tips
        const tips = root.createDiv({ cls: 'bridge-help-section' });
        tips.createEl('h4', { text: 'Quick Tips' });
        const tipItems = [
            '• Monsters at 0 HP auto-disable & move to graveyard',
            '• PC death requires manual graveyard (death saves)',
            '• HP/AC syncs live from D&D Beyond',
            '• Summon & wildshape HP track automatically',
        ];
        for (const tip of tipItems) {
            tips.createDiv({ cls: 'bridge-help-item', text: tip });
        }
    }
}
