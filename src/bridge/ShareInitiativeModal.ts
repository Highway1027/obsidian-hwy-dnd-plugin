// src/bridge/ShareInitiativeModal.ts
// DM window for connecting the Obsidian Initiative Tracker to a webapp tracker:
// one list, pick exactly one option (a new tracker, or an existing one).

import { App, Modal, Notice } from 'obsidian';
import { authenticateWithApiToken, isAuthenticated } from '../firebase';
import { InitiativeBridgeManager } from './InitiativeBridgeManager';
import {
    NEW_TRACKER, sortTrackers, defaultChoice, defaultTrackerName, trackerDetails, type TrackerSummary
} from './connectChoices';

interface PluginSettings {
    apiToken: string;
    caravanId: string;
    lastUsedCaravanId: string;
    lastTrackerId: string;
    lastTrackerConnectedAt: number;
    enableInitiativeBridge: boolean;
}

export class ShareInitiativeModal extends Modal {
    private settings: PluginSettings;
    private bridgeManager: InitiativeBridgeManager;
    private saveSettings: () => Promise<void>;

    // State
    private trackers: TrackerSummary[] = [];
    private choice: string = NEW_TRACKER;   // NEW_TRACKER or a tracker id
    private newTrackerName: string = '';     // typed by the DM; empty = defaultName
    private defaultName: string = '';
    private connectBtn: HTMLButtonElement | null = null;

    constructor(
        app: App,
        settings: PluginSettings,
        bridgeManager: InitiativeBridgeManager,
        saveSettings: () => Promise<void>
    ) {
        super(app);
        this.settings = settings;
        this.bridgeManager = bridgeManager;
        this.saveSettings = saveSettings;
    }

    async onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass('hwy-share-initiative-modal');
        this.titleEl.setText('Connect to the webapp');

        const loadingEl = contentEl.createEl('p', { text: 'Connecting to the webapp...' });

        try {
            if (!isAuthenticated()) {
                loadingEl.setText('Signing in...');
                await authenticateWithApiToken(this.settings.apiToken);
            }

            const caravanId = this.settings.lastUsedCaravanId || this.settings.caravanId;
            if (!caravanId) {
                loadingEl.setText('⚠️ No campaign set. Add your Caravan ID in the plugin settings.');
                loadingEl.addClass('hwy-error');
                return;
            }

            loadingEl.setText('Loading trackers...');
            const [trackers, caravanName] = await Promise.all([
                this.bridgeManager.fetchActiveTrackers(caravanId),
                this.bridgeManager.fetchCaravanName(caravanId),
            ]);
            this.trackers = sortTrackers(trackers);

            // Remember the caravan for next time
            this.settings.lastUsedCaravanId = caravanId;
            await this.saveSettings();

            loadingEl.remove();
            this.render(contentEl, caravanId, caravanName);
        } catch (error: any) {
            console.error('[ShareInitiativeModal] Error:', error);
            loadingEl.setText(`❌ Error: ${error.message}`);
            loadingEl.addClass('hwy-error');
        }
    }

    private render(container: HTMLElement, caravanId: string, caravanName: string | null): void {
        const now = Date.now();
        this.newTrackerName = '';
        this.defaultName = defaultTrackerName(new Date(now));
        this.choice = defaultChoice(
            this.trackers,
            { trackerId: this.settings.lastTrackerId, connectedAt: this.settings.lastTrackerConnectedAt },
            now
        );

        // Context: which campaign, what is in IT now.
        const { creatures, players } = this.bridgeManager.getEncounterSummary();
        container.createEl('p', {
            cls: 'hwy-connect-context',
            text: `Campaign: ${caravanName ?? caravanId} · In Obsidian: ${creatures} ` +
                `${creatures === 1 ? 'creature' : 'creatures'} (${players} ${players === 1 ? 'player' : 'players'})`,
        });

        const list = container.createDiv({ cls: 'hwy-connect-list' });
        const options: { id: string; el: HTMLElement; radio: HTMLInputElement }[] = [];

        const select = (id: string) => {
            this.choice = id;
            for (const o of options) {
                o.el.toggleClass('is-selected', o.id === id);
                o.radio.checked = o.id === id;
            }
            this.updateConnectButton();
        };

        const addOption = (id: string): HTMLElement => {
            const el = list.createEl('label', { cls: 'hwy-connect-option' });
            const radio = el.createEl('input', { type: 'radio', attr: { name: 'hwy-connect-choice' } });
            const body = el.createDiv({ cls: 'hwy-connect-option-body' });
            radio.addEventListener('change', () => select(id));
            options.push({ id, el, radio });
            return body;
        };

        // 1. A new tracker. The name field starts empty with the date and time greyed out
        //    behind it, so the DM can type a name straight away or leave it as is.
        const newBody = addOption(NEW_TRACKER);
        newBody.createDiv({ cls: 'hwy-connect-option-title', text: 'New tracker for this encounter' });
        newBody.createDiv({ cls: 'hwy-connect-name-label', text: 'Name (optional)' });
        const nameInput = newBody.createEl('input', {
            type: 'text', cls: 'hwy-connect-name', attr: { placeholder: this.defaultName },
        });
        nameInput.addEventListener('focus', () => select(NEW_TRACKER));
        nameInput.addEventListener('input', () => {
            this.newTrackerName = nameInput.value;
            this.updateConnectButton();
        });
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.handleConnect(caravanId);
        });

        // 2. Existing trackers, newest first.
        if (this.trackers.length > 0) {
            list.createDiv({ cls: 'hwy-connect-heading', text: 'Or join an existing webapp tracker' });
        }
        for (const tracker of this.trackers) {
            const body = addOption(tracker.id);
            const title = body.createDiv({ cls: 'hwy-connect-option-title', text: tracker.name });
            if (tracker.id === this.settings.lastTrackerId) {
                title.createSpan({ cls: 'hwy-connect-badge', text: 'last used' });
            }
            body.createDiv({ cls: 'hwy-connect-option-details', text: trackerDetails(tracker, now) });
            body.parentElement!.addEventListener('dblclick', () => {
                select(tracker.id);
                this.handleConnect(caravanId);
            });
        }

        // Buttons
        const buttons = container.createDiv({ cls: 'hwy-button-container' });
        buttons.createEl('button', { text: 'Cancel' }).addEventListener('click', () => this.close());
        this.connectBtn = buttons.createEl('button', { cls: 'mod-cta' });
        this.connectBtn.addEventListener('click', () => this.handleConnect(caravanId));

        select(this.choice);
        // Preselected new tracker: the cursor waits in the name field.
        if (this.choice === NEW_TRACKER) window.setTimeout(() => nameInput.focus(), 0);
    }

    /** The button says what will happen. */
    private updateConnectButton(): void {
        if (!this.connectBtn) return;
        if (this.choice === NEW_TRACKER) {
            this.connectBtn.setText('Create & connect');
            this.connectBtn.disabled = false;
        } else {
            const tracker = this.trackers.find(t => t.id === this.choice);
            this.connectBtn.setText(`Connect to "${tracker?.name ?? 'tracker'}"`);
            this.connectBtn.disabled = false;
        }
    }

    private async handleConnect(caravanId: string): Promise<void> {
        const { contentEl } = this;
        const choice = this.choice;
        const name = this.newTrackerName.trim() || this.defaultName;

        contentEl.empty();
        contentEl.createEl('p', { text: '⏳ Setting up the bridge...' });

        try {
            let trackerId: string;
            if (choice === NEW_TRACKER) {
                trackerId = await this.bridgeManager.createNewTracker(caravanId, name);
            } else {
                trackerId = choice;
                await this.bridgeManager.mergeWithExistingTracker(caravanId, trackerId);
            }

            // Start the bidirectional sync
            await this.bridgeManager.connect(caravanId, trackerId);

            new Notice('🟢 Initiative Bridge connected!');
            this.close();
        } catch (error: any) {
            console.error('[ShareInitiativeModal] Connect error:', error);
            contentEl.empty();
            contentEl.createEl('p', { text: `❌ Failed to connect: ${error.message}`, cls: 'hwy-error' });
            const retryBtn = contentEl.createEl('button', { text: 'Retry', cls: 'mod-cta' });
            retryBtn.addEventListener('click', () => this.onOpen());
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
