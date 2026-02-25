// src/bridge/ShareInitiativeModal.ts
// v1 - 25-02-2026 - DM popup for sharing initiative between Obsidian and webapp

import { App, Modal, Notice, Setting } from 'obsidian';
import { authenticateWithApiToken, isAuthenticated } from '../firebase';
import { InitiativeBridgeManager } from './InitiativeBridgeManager';

interface PluginSettings {
    apiToken: string;
    caravanId: string;
    lastUsedCaravanId: string;
    enableInitiativeBridge: boolean;
}

/**
 * Modal for the DM to share their Obsidian Initiative Tracker
 * with the webapp. Handles caravan selection, tracker selection,
 * and initiating the bridge connection.
 */
export class ShareInitiativeModal extends Modal {
    private settings: PluginSettings;
    private bridgeManager: InitiativeBridgeManager;
    private saveSettings: () => Promise<void>;

    // State
    private activeTrackers: any[] = [];
    private isLoading: boolean = true;
    private selectedTrackerId: string | null = null;
    private newTrackerName: string = '';

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

        contentEl.createEl('h2', { text: '🎲 Share Initiative to Webapp' });

        // Show loading state
        const loadingEl = contentEl.createDiv({ cls: 'hwy-loading' });
        loadingEl.createEl('p', { text: 'Connecting to webapp...' });

        try {
            // 1. Authenticate with Firebase SDK if needed
            if (!isAuthenticated()) {
                loadingEl.setText('Authenticating...');
                await authenticateWithApiToken(this.settings.apiToken);
            }

            // 2. Get the caravan ID
            const caravanId = this.settings.lastUsedCaravanId || this.settings.caravanId;
            if (!caravanId) {
                loadingEl.remove();
                contentEl.createEl('p', {
                    text: '⚠️ No caravan ID configured. Please set your Caravan ID in plugin settings.',
                    cls: 'hwy-error'
                });
                return;
            }

            // 3. Fetch active trackers
            loadingEl.setText('Fetching active trackers...');
            this.activeTrackers = await this.bridgeManager.fetchActiveTrackers(caravanId);

            // Remember the caravan for next time
            this.settings.lastUsedCaravanId = caravanId;
            await this.saveSettings();

            // 4. Render the UI
            loadingEl.remove();
            this.renderTrackerSelection(contentEl, caravanId);

        } catch (error: any) {
            loadingEl.remove();
            console.error('[ShareInitiativeModal] Error:', error);
            contentEl.createEl('p', {
                text: `❌ Error: ${error.message}`,
                cls: 'hwy-error'
            });
        }
    }

    private renderTrackerSelection(container: HTMLElement, caravanId: string): void {
        // If there are existing trackers, show them
        if (this.activeTrackers.length > 0) {
            container.createEl('h3', { text: 'Existing Trackers' });
            container.createEl('p', {
                text: 'Select a tracker to merge your initiative, or create a new one.',
                cls: 'hwy-subtitle'
            });

            const trackerList = container.createDiv({ cls: 'hwy-tracker-list' });

            for (const tracker of this.activeTrackers) {
                const trackerEl = trackerList.createDiv({ cls: 'hwy-tracker-item' });
                trackerEl.style.padding = '8px 12px';
                trackerEl.style.margin = '4px 0';
                trackerEl.style.borderRadius = '6px';
                trackerEl.style.cursor = 'pointer';
                trackerEl.style.border = '1px solid var(--background-modifier-border)';

                const nameEl = trackerEl.createSpan({ text: tracker.name, cls: 'hwy-tracker-name' });
                nameEl.style.fontWeight = 'bold';

                const infoEl = trackerEl.createSpan({
                    text: ` — Round ${tracker.round}, ${tracker.combatantCount} combatants`,
                    cls: 'hwy-tracker-info'
                });
                infoEl.style.opacity = '0.7';
                infoEl.style.fontSize = '0.9em';

                trackerEl.addEventListener('click', () => {
                    // Deselect all
                    trackerList.querySelectorAll('.hwy-tracker-item').forEach(el => {
                        (el as HTMLElement).style.backgroundColor = '';
                    });
                    // Select this one
                    trackerEl.style.backgroundColor = 'var(--interactive-accent)';
                    trackerEl.style.color = 'var(--text-on-accent)';
                    this.selectedTrackerId = tracker.id;
                });
            }

            // Separator
            container.createEl('hr');
        }

        // "Create New" section
        container.createEl('h3', { text: 'Create New Tracker' });

        const nameContainer = container.createDiv();
        const now = new Date();
        const defaultName = `Combat - ${now.toLocaleDateString()} ${now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

        new Setting(nameContainer)
            .setName('Tracker Name')
            .setDesc('Leave empty for default name')
            .addText(text => {
                text.setPlaceholder(defaultName);
                text.onChange(value => {
                    this.newTrackerName = value.trim();
                });
            });

        // Action buttons
        const buttonContainer = container.createDiv({ cls: 'hwy-button-container' });
        buttonContainer.style.display = 'flex';
        buttonContainer.style.gap = '8px';
        buttonContainer.style.marginTop = '16px';
        buttonContainer.style.justifyContent = 'flex-end';

        // Cancel button
        const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
        cancelBtn.addEventListener('click', () => this.close());

        // Connect button
        const connectBtn = buttonContainer.createEl('button', {
            text: this.activeTrackers.length > 0 ? 'Connect' : 'Create & Connect',
            cls: 'mod-cta'
        });
        connectBtn.addEventListener('click', async () => {
            await this.handleConnect(caravanId, defaultName);
        });
    }

    private async handleConnect(caravanId: string, defaultName: string): Promise<void> {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('p', { text: '⏳ Setting up bridge...' });

        try {
            let trackerId: string;

            if (this.selectedTrackerId) {
                // Merge with existing tracker
                trackerId = this.selectedTrackerId;
                await this.bridgeManager.mergeWithExistingTracker(caravanId, trackerId);
            } else {
                // Create new tracker
                const name = this.newTrackerName || defaultName;
                trackerId = await this.bridgeManager.createNewTracker(caravanId, name);
            }

            // Start the bidirectional sync
            await this.bridgeManager.connect(caravanId, trackerId);

            new Notice('🟢 Initiative Bridge connected!');
            this.close();

        } catch (error: any) {
            console.error('[ShareInitiativeModal] Connect error:', error);
            contentEl.empty();
            contentEl.createEl('p', {
                text: `❌ Failed to connect: ${error.message}`,
                cls: 'hwy-error'
            });

            const retryBtn = contentEl.createEl('button', { text: 'Retry', cls: 'mod-cta' });
            retryBtn.addEventListener('click', () => this.onOpen());
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}
