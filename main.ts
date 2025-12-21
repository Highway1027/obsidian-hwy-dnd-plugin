// main.ts
// v8 - Fixed TypeScript error for 'unknown' value type in materials loop.
import { App, Notice, Plugin, PluginSettingTab, Setting, Modal, MarkdownView, requestUrl } from 'obsidian';

// Define the settings that our plugin will store.
interface HwysDnDToolsSettings {
    apiToken: string;
    defaultCaravanId: string;
    theme: 'default' | 'parchment' | 'ffix' | 'cyberpunk' | 'custom';
    customColors: {
        bgPrimary: string;
        bgSecondary: string;
        accent: string;
        textPrimary: string;
        textSecondary: string;
        border: string;
    }
}

// Set the default values for the settings.
const DEFAULT_SETTINGS: HwysDnDToolsSettings = {
    apiToken: '',
    defaultCaravanId: '',
    theme: 'default',
    customColors: {
        bgPrimary: '221, 39%, 11%',
        bgSecondary: '219, 28%, 17%',
        accent: '38, 92%, 50%',
        textPrimary: '220, 13%, 91%',
        textSecondary: '220, 9%, 61%',
        border: '220, 14%, 26%'
    }
}

// This is the main class for our plugin.
export default class HwysDnDToolsPlugin extends Plugin {
    settings: HwysDnDToolsSettings;

    // This function runs when the plugin is first loaded.
    async onload() {
        await this.loadSettings();

        this.addCommand({
            id: 'insert-caravan-status',
            name: 'Insert Caravan Status',
            callback: async () => {
                if (!this.settings.apiToken) {
                    new Notice('Error: API Token not set. Please add it in the plugin settings.');
                    return;
                }

                let caravanId: string | null = this.settings.defaultCaravanId;

                if (!caravanId) {
                    caravanId = await this.promptForCaravanId();
                    if (!caravanId) {
                        return;
                    }
                }

                try {
                    new Notice('Fetching Caravan Status...');

                    const projectId = 'wildshape-tracker';
                    const region = 'europe-west1';
                    const functionName = 'obsidianGetCaravanStatus';
                    const apiUrl = `https://${region}-${projectId}.cloudfunctions.net/${functionName}`;

                    const response = await requestUrl({
                        url: apiUrl,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            apiToken: this.settings.apiToken,
                            caravanId: caravanId
                        })
                    });

                    const result = response.json;
                    const markdownString = this.formatDataToMarkdown(result);

                    const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                    if (activeView) {
                        const editor = activeView.editor;
                        editor.replaceSelection(markdownString);
                        new Notice('Caravan Status inserted!');
                    } else {
                        new Notice('Error: No active editor found. Please open a note first.');
                    }

                } catch (error) {
                    console.error('Highway DnD Tools - Error fetching data:', error);
                    const errorMessage = error.json?.error?.message || 'An unknown error occurred.';
                    new Notice(`Error: ${errorMessage}`, 10000);
                }
            }
        });

        // Command: Insert Caravan Logs Range
        this.addCommand({
            id: 'insert-caravan-logs-range',
            name: 'Insert Caravan Logs Range',
            callback: async () => {
                if (!this.settings.apiToken) {
                    new Notice('Error: API Token not set.');
                    return;
                }

                let caravanId: string | null = this.settings.defaultCaravanId;
                if (!caravanId) {
                    caravanId = await this.promptForCaravanId();
                    if (!caravanId) return;
                }

                try {
                    // 1. Fetch current status minimally to get the "Max Day"
                    // (We could persist this, but fetching ensures freshness)
                    new Notice('Fetching current day...');
                    const projectId = 'wildshape-tracker';
                    const region = 'europe-west1';
                    const fetchUrl = `https://${region}-${projectId}.cloudfunctions.net/obsidianGetCaravanStatus`;

                    const statusRes = await requestUrl({
                        url: fetchUrl,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ apiToken: this.settings.apiToken, caravanId })
                    });
                    const currentDay = statusRes.json.currentDay || 0;

                    // 2. Open Modal to pick range
                    new CaravanLogRangeModal(this.app, currentDay, async (min, max) => {
                        new Notice(`Fetching logs from Day ${min} to ${max}...`);

                        const logsUrl = `https://${region}-${projectId}.cloudfunctions.net/obsidianGetCaravanLogs`;
                        const logsRes = await requestUrl({
                            url: logsUrl,
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                apiToken: this.settings.apiToken,
                                caravanId,
                                minDay: min,
                                maxDay: max
                            })
                        });

                        const logs = logsRes.json.logs || [];
                        if (logs.length === 0) {
                            new Notice("No logs found in that range.");
                            return;
                        }

                        // 3. Generate HTML Output
                        let html = '';

                        // Theme Container Setup
                        let containerStyleResult = '';
                        if (this.settings.theme === 'custom') {
                            const c = this.settings.customColors;
                            containerStyleResult = `style="--hwy-bg-primary: ${c.bgPrimary}; --hwy-bg-secondary: ${c.bgSecondary}; --hwy-accent: ${c.accent}; --hwy-text-primary: ${c.textPrimary}; --hwy-text-secondary: ${c.textSecondary}; --hwy-border: ${c.border};"`;
                        }

                        html += `<div class="hwy-logs-container" data-theme="${this.settings.theme}" ${containerStyleResult}>\n`;
                        html += `<h3>Caravan Logs (Day ${min} - ${max})</h3>\n\n`;

                        for (const log of logs) {
                            // Strip "Day X" / "Dag X" prefix
                            let text: string = log.text;
                            const prefixRegex = /^(Day|Dag)\s+\d+[:.]?\s*/i;
                            text = text.replace(prefixRegex, "").trim();

                            html += `  <div class="hwy-log-card">\n`;
                            html += `    <div class="hwy-card-header">\n`;
                            html += `      <span class="hwy-day-badge">Day ${log.day}</span>\n`;
                            html += `    </div>\n`;
                            html += `    <div class="hwy-card-body">${text}</div>\n`;
                            html += `  </div>\n`;
                        }
                        html += `</div>\n`;

                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView) {
                            activeView.editor.replaceSelection(html);
                            new Notice('Logs inserted!');
                        }
                    }).open();

                } catch (error) {
                    new Notice("Error fetching data: " + error.message);
                }
            }
        });

        // ... (Existing code)

        // Command: Send Selection to Initiative
        this.addCommand({
            id: 'send-selection-to-initiative',
            name: 'Send Selection to Initiative',
            callback: async () => {
                const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (!activeView) {
                    new Notice('No active editor found.');
                    return;
                }

                const selection = activeView.editor.getSelection();
                if (!selection) {
                    new Notice('Please select some text first.');
                    return;
                }

                if (!this.settings.apiToken) {
                    new Notice('Error: API Token not set.');
                    return;
                }

                let caravanId: string | null = this.settings.defaultCaravanId;
                if (!caravanId) {
                    caravanId = await this.promptForCaravanId();
                    if (!caravanId) return;
                }

                new InitiativeConnectorModal(this.app, this, selection, caravanId).open();
            }
        });

        this.addSettingTab(new HwysDnDToolsSettingTab(this.app, this));
    }

    promptForCaravanId(): Promise<string | null> {
        return new Promise((resolve) => {
            new CaravanIdModal(this.app, (result) => {
                resolve(result);
            }).open();
        });
    }

    formatDataToMarkdown(data: any): string {
        let md = ``;
        md += `### **${data.caravanName} - Day ${data.currentDay}**\n`;
        md += `| PCs | NPCs | Defense |\n`;
        md += `|:---:|:----:|:-------:|\n`;
        md += `| ${data.pcCount} | ${data.npcCount} | ${data.defense} |\n`;

        md += `\n#### Resources\n`;
        for (const stat of data.mainResources) {
            md += `- **${stat.label}:** ${stat.value}`;
            if (stat.max != null) { // Use != null to check for both null and undefined
                md += `/${stat.max}`;
            }
            md += `\n`;
        }

        md += `\n#### Materials\n`;
        if (data.materials && Object.keys(data.materials).length > 0) {
            let hasMaterials = false;
            for (const [key, value] of Object.entries(data.materials)) {
                hasMaterials = true;
                const capitalizedKey = key.charAt(0).toUpperCase() + key.slice(1);
                md += `- **${capitalizedKey}:** ${value}/100\n`;
            }
            if (!hasMaterials) {
                md += `_No materials._\n`;
            }
        } else {
            md += `_No materials._\n`;
        }

        // Recent Logs Section
        if (data.recentLogs && data.recentLogs.length > 0) {

            // Theme Container Setup
            let containerStyleResult = '';
            if (this.settings.theme === 'custom') {
                const c = this.settings.customColors;
                containerStyleResult = `style="--hwy-bg-primary: ${c.bgPrimary}; --hwy-bg-secondary: ${c.bgSecondary}; --hwy-accent: ${c.accent}; --hwy-text-primary: ${c.textPrimary}; --hwy-text-secondary: ${c.textSecondary}; --hwy-border: ${c.border};"`;
            }

            md += `\n<div class="hwy-logs-container" data-theme="${this.settings.theme}" ${containerStyleResult}>\n`;
            md += `<h4>Recent Activity</h4>\n`;

            if (data.logSummary) {
                // Summary Card
                md += `  <div class="hwy-log-card hwy-summary-card">\n`;
                md += `    <div class="hwy-card-header">\n`;
                md += `       <span class="hwy-day-badge">Weekly Summary</span>\n`;
                md += `    </div>\n`;
                md += `    <div class="hwy-card-body">${data.logSummary}</div>\n`;
                md += `  </div>\n`;
            }

            for (const log of data.recentLogs) {
                let text: string = log.text;
                const prefixRegex = /^(Day|Dag)\s+\d+[:.]?\s*/i;
                text = text.replace(prefixRegex, "").trim();

                md += `  <div class="hwy-log-card">\n`;
                md += `    <div class="hwy-card-header">\n`;
                md += `      <span class="hwy-day-badge">Day ${log.day}</span>\n`;
                md += `    </div>\n`;
                md += `    <div class="hwy-card-body">${text}</div>\n`;
                md += `  </div>\n`;
            }
            md += `</div>\n`;
        }

        md += `\n`;
        return md;
    }

    onunload() { }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

// Interaces for API responses
interface CombatantDraft {
    name: string;
    quantity: number;
    ac?: number;
    initiative_modifier?: number;
    initiative?: number; // Added to store rolled value
    original_text_reference?: string;
}

interface ActiveTracker {
    id: string;
    name: string;
    round: number;
    updatedAt: any;
}

class InitiativeConnectorModal extends Modal {
    plugin: HwysDnDToolsPlugin;
    text: string;
    caravanId: string;

    // State
    loading: boolean = false;
    parsedCombatants: CombatantDraft[] = [];
    activeTrackers: ActiveTracker[] = [];
    selectedTrackerId: string = 'NEW';
    newTrackerName: string = '';

    constructor(app: App, plugin: HwysDnDToolsPlugin, text: string, caravanId: string) {
        super(app);
        this.plugin = plugin;
        this.text = text;
        this.caravanId = caravanId;
    }

    async onOpen() {
        this.containerEl.addClass("mod-wide"); // Widen the modal
        await this.fetchParsedData();
        this.display();
    }

    async fetchParsedData() {
        this.loading = true;
        this.display(); // Show loading state

        try {
            const projectId = 'wildshape-tracker';
            const region = 'europe-west1';
            const url = `https://${region}-${projectId}.cloudfunctions.net/obsidianParseCombatText`;

            const response = await requestUrl({
                url: url,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiToken: this.plugin.settings.apiToken,
                    caravanId: this.caravanId,
                    text: this.text
                })
            });

            const data = response.json;
            this.parsedCombatants = data.parsedCombatants || [];
            this.activeTrackers = data.activeTrackers || [];

            // Default to most recent if available? No, default to NEW usually safer unless obvious.
            this.selectedTrackerId = 'NEW';
            this.newTrackerName = (data as any).suggestedEncounterName || `Encounter from Obsidian notes`;

        } catch (error) {
            new Notice("Error parsing text: " + error.message);
            this.close();
            return;
        } finally {
            this.loading = false;
            this.display();
        }
    }

    display() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "Send to Initiative Tracker" });

        if (this.loading) {
            contentEl.createDiv({ text: "Parsing text with Gemini AI...", cls: "loading-spinner" }); // (Simple text for now)
            return;
        }

        const mainContainer = contentEl.createDiv();
        mainContainer.style.display = 'flex';
        mainContainer.style.flexDirection = 'column';
        mainContainer.style.gap = '15px';

        // 1. Tracker Selection
        const trackerSection = mainContainer.createDiv({ cls: 'setting-item' });
        trackerSection.style.flexDirection = 'column';
        trackerSection.style.alignItems = 'flex-start';

        trackerSection.createEl("h3", { text: "Target Tracker" });

        const trackerSelect = trackerSection.createEl("select");
        trackerSelect.style.width = '100%';

        // Option: New
        const newOpt = trackerSelect.createEl("option", { value: "NEW", text: "[Create New Tracker]" });
        newOpt.selected = this.selectedTrackerId === 'NEW';

        // Options: Existing
        this.activeTrackers.forEach(t => {
            const opt = trackerSelect.createEl("option", { value: t.id, text: `${t.name} (Round ${t.round})` });
            if (t.id === this.selectedTrackerId) opt.selected = true;
        });

        trackerSelect.addEventListener('change', () => {
            this.selectedTrackerId = trackerSelect.value;
            const nameInputDiv = this.contentEl.querySelector('#hwy-new-tracker-name') as HTMLElement;
            if (nameInputDiv) nameInputDiv.style.display = this.selectedTrackerId === 'NEW' ? 'block' : 'none';
        });

        // New Tracker Name Input
        const nameInputDiv = trackerSection.createDiv();
        nameInputDiv.id = 'hwy-new-tracker-name';
        nameInputDiv.style.width = '100%';
        nameInputDiv.style.marginTop = '5px';
        nameInputDiv.style.display = this.selectedTrackerId === 'NEW' ? 'block' : 'none';

        const nameInput = nameInputDiv.createEl("input", { type: "text", value: this.newTrackerName });
        nameInput.placeholder = "New Tracker Name";
        nameInput.style.width = '100%';
        nameInput.addEventListener('input', (e) => this.newTrackerName = (e.target as HTMLInputElement).value);


        // 2. Combatants Review
        const combatantsSection = mainContainer.createDiv();
        combatantsSection.createEl("h3", { text: "Review Combatants" });

        // Header Row
        const headerRow = combatantsSection.createDiv();
        headerRow.style.display = 'grid';
        headerRow.style.gridTemplateColumns = '2fr 0.5fr 0.8fr 0.8fr 0.5fr 20px'; // Name, Qty, InitMod, InitVal, Roll, Del
        headerRow.style.gap = '5px';
        headerRow.style.marginBottom = '5px';
        headerRow.style.fontWeight = 'bold';
        headerRow.style.fontSize = '0.8em';
        headerRow.style.color = 'var(--text-muted)';

        headerRow.createDiv({ text: "Name" });
        headerRow.createDiv({ text: "Qty" });
        headerRow.createDiv({ text: "Init Mod" });
        headerRow.createDiv({ text: "Init" });
        headerRow.createDiv({ text: "Roll" });
        headerRow.createDiv({ text: "" });


        const listDiv = combatantsSection.createDiv();
        listDiv.style.overflowY = 'auto';
        listDiv.style.maxHeight = '300px';

        this.parsedCombatants.forEach((c, index) => {
            const row = listDiv.createDiv();
            row.style.display = 'grid';
            row.style.gridTemplateColumns = '2fr 0.5fr 0.8fr 0.8fr 0.5fr 0.5fr 20px';
            row.style.gap = '5px';
            row.style.marginBottom = '5px';
            row.style.alignItems = 'center';

            // Name
            const cName = row.createEl("input", { type: "text", value: c.name });
            cName.placeholder = "Name";
            cName.style.width = '100%';
            cName.addEventListener('change', (e) => c.name = (e.target as HTMLInputElement).value);

            // Qty
            const cQty = row.createEl("input", { type: "number", value: String(c.quantity) });
            cQty.placeholder = "#";
            cQty.min = "1";
            cQty.style.width = '100%';
            cQty.addEventListener('change', (e) => c.quantity = parseInt((e.target as HTMLInputElement).value));

            // Init Mod (No longer hidden AC)
            const cInitMod = row.createEl("input", { type: "number", value: c.initiative_modifier !== undefined ? String(c.initiative_modifier) : "0" });
            cInitMod.placeholder = "+/-";
            cInitMod.style.width = '100%';
            cInitMod.title = "Dexterity Modifier";
            cInitMod.addEventListener('change', (e) => c.initiative_modifier = parseInt((e.target as HTMLInputElement).value) || 0);

            // Init Value (The actual roll)
            // Use 'any' type cast if 'initiative' is missing in definition, but better to update interface.
            // For now, I'll assume we add 'initiative' to CombatantDraft.
            const cInitVal = row.createEl("input", { type: "number", value: (c as any).initiative ? String((c as any).initiative) : "" });
            cInitVal.placeholder = "Roll";
            cInitVal.style.width = '100%';
            cInitVal.addEventListener('change', (e) => (c as any).initiative = parseInt((e.target as HTMLInputElement).value) || undefined);

            // Roll Button
            const rollBtn = row.createEl("button", { text: "🎲" });
            rollBtn.title = "Roll d20 + Mod";
            rollBtn.style.padding = '0 5px';
            rollBtn.addEventListener('click', () => {
                const mod = c.initiative_modifier || 0;
                const roll = Math.floor(Math.random() * 20) + 1;
                const total = roll + mod;
                (c as any).initiative = total;
                cInitVal.value = String(total);
                new Notice(`Rolled ${roll} + ${mod} = ${total} for ${c.name}`);
            });

            // Expand/Split Button (Only if Qty > 1)
            if (c.quantity > 1) {
                const expandBtn = row.createEl("button", { text: "↔" });
                expandBtn.title = "Split into individual rows";
                expandBtn.style.padding = '0 5px';
                expandBtn.style.fontWeight = 'bold';
                expandBtn.addEventListener('click', () => {
                    // 1. Remove this row
                    this.parsedCombatants.splice(index, 1);

                    // 2. Add N new rows with numbering
                    for (let i = 0; i < c.quantity; i++) {
                        this.parsedCombatants.splice(index + i, 0, {
                            name: `${c.name} ${i + 1}`,
                            quantity: 1,
                            ac: c.ac,
                            initiative_modifier: c.initiative_modifier,
                            initiative: undefined // Force new roll
                        });
                    }
                    // 3. Re-render
                    this.display();
                });
            } else {
                // Spacer for alignment if no expand button
                row.createDiv();
            }






            // Delete Btn
            const delBtn = row.createEl("button", { text: "X" });
            delBtn.style.color = 'var(--text-error)';
            delBtn.style.padding = '0';
            delBtn.style.height = '24px';
            delBtn.style.width = '24px';
            delBtn.style.display = 'flex';
            delBtn.style.alignItems = 'center';
            delBtn.style.justifyContent = 'center';
            delBtn.title = "Remove";
            delBtn.addEventListener('click', () => {
                this.parsedCombatants.splice(index, 1);
                this.display(); // Re-render
            });
        });

        // Add Manual Row Button + Roll All
        const actionsRow = combatantsSection.createDiv();
        actionsRow.style.display = 'flex';
        actionsRow.style.gap = '10px';
        actionsRow.style.marginTop = '10px';

        const addBtn = actionsRow.createEl("button", { text: "+ Add Row" });
        addBtn.addEventListener('click', () => {
            this.parsedCombatants.push({ name: "New Enemy", quantity: 1, initiative_modifier: 0 });
            this.display();
        });

        const rollAllBtn = actionsRow.createEl("button", { text: "🎲 Roll All Empty" });
        rollAllBtn.addEventListener('click', () => {
            let rolledCount = 0;
            this.parsedCombatants.forEach(c => {
                if (!(c as any).initiative) {
                    const mod = c.initiative_modifier || 0;
                    const roll = Math.floor(Math.random() * 20) + 1;
                    (c as any).initiative = roll + mod;
                    rolledCount++;
                }
            });
            if (rolledCount > 0) {
                this.display();
                new Notice(`Rolled initiative for ${rolledCount} combatants.`);
            } else {
                new Notice("All combatants already have initiative.");
            }
        });

        // 3. Footer Actions
        const footer = contentEl.createDiv();
        footer.style.display = 'flex';
        footer.style.justifyContent = 'flex-end';
        footer.style.gap = '10px';
        footer.style.marginTop = '20px';

        const cancelBtn = footer.createEl("button", { text: "Cancel" });
        cancelBtn.addEventListener('click', () => this.close());

        const confirmBtn = footer.createEl("button", { text: "Send to Tracker" });
        confirmBtn.addClass("mod-cta");
        confirmBtn.addEventListener('click', () => this.submit());
    }

    async submit() {
        // Validate
        if (this.parsedCombatants.length === 0) {
            new Notice("No combatants to add.");
            return;
        }

        try {
            const projectId = 'wildshape-tracker';
            const region = 'europe-west1';
            const url = `https://${region}-${projectId}.cloudfunctions.net/obsidianAddCombatants`;

            new Notice("Sending to tracker...");

            await requestUrl({
                url: url,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    apiToken: this.plugin.settings.apiToken,
                    caravanId: this.caravanId,
                    trackerId: this.selectedTrackerId,
                    newTrackerName: this.newTrackerName,
                    combatants: this.parsedCombatants
                })
            });

            new Notice("Successfully added to Initiative Tracker!");
            this.close();

        } catch (error) {
            new Notice("Error sending data: " + error.message);
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

// ... (Existing SettingTab and Modals)
class HwysDnDToolsSettingTab extends PluginSettingTab {
    plugin: HwysDnDToolsPlugin;

    constructor(app: App, plugin: HwysDnDToolsPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Highway DnD Tools Settings' });

        // Version Display
        const manifest = this.plugin.manifest;
        containerEl.createEl('div', {
            text: `Version ${manifest.version}`,
            cls: 'setting-item-description',
            attr: { style: 'margin-bottom: 20px; font-style: italic; color: var(--text-muted);' }
        });

        new Setting(containerEl)
            .setName('API Token')
            .setDesc('Paste your personal API token generated from the Highway DnD Tools website.')
            .addText(text => text
                .setPlaceholder('Enter your API token')
                .setValue(this.plugin.settings.apiToken)
                .onChange(async (value) => {
                    this.plugin.settings.apiToken = value.trim();
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Caravan ID')
            .setDesc(' (Optional) Paste the ID of your main caravan to skip being prompted each time.')
            .addText(text => text
                .setPlaceholder('Enter your default Caravan ID')
                .setValue(this.plugin.settings.defaultCaravanId)
                .onChange(async (value) => {
                    this.plugin.settings.defaultCaravanId = value.trim();
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Theme Settings' });

        new Setting(containerEl)
            .setName('Visual Theme')
            .setDesc('Select the style for recent logs and summaries.')
            .addDropdown(dropdown => dropdown
                .addOption('default', 'Wildshape Dark (Webapp Match)')
                .addOption('parchment', 'D&D Parchment')
                .addOption('ffix', 'Final Fantasy IX')
                .addOption('cyberpunk', 'Cyberpunk 2077')
                .addOption('custom', 'Custom Colors')
                .setValue(this.plugin.settings.theme)
                .onChange(async (value: any) => {
                    this.plugin.settings.theme = value;
                    await this.plugin.saveSettings();
                    this.display(); // Refresh to show/hide custom colors
                }));

        if (this.plugin.settings.theme === 'custom') {
            const addColorSetting = (name: string, desc: string, key: keyof HwysDnDToolsSettings['customColors']) => {
                new Setting(containerEl)
                    .setName(name)
                    .setDesc(desc + ' (Format: H, S%, L% e.g., "221, 39%, 11%")')
                    .addText(text => text
                        .setValue(this.plugin.settings.customColors[key])
                        .onChange(async (value) => {
                            this.plugin.settings.customColors[key] = value.trim();
                            await this.plugin.saveSettings();
                        }));
            };

            addColorSetting('Background Primary', 'Main background color', 'bgPrimary');
            addColorSetting('Background Secondary', 'Card background color', 'bgSecondary');
            addColorSetting('Accent Color', 'Highlight color', 'accent');
            addColorSetting('Text Primary', 'Main text color', 'textPrimary');
            addColorSetting('Text Secondary', 'Subtext color', 'textSecondary');
            addColorSetting('Border Color', 'Border color', 'border');
        }

        // Command Reference
        containerEl.createEl('h3', { text: 'Available Commands', attr: { style: 'margin-top: 30px;' } });

        containerEl.createEl('p', { text: 'Use these commands via the Command Palette (Ctrl/Cmd + P):' });

        const cmdList = containerEl.createEl('ul');

        const cmd1 = cmdList.createEl('li');
        cmd1.createEl('strong', { text: 'Insert Caravan Status: ' });
        cmd1.createSpan({ text: 'Inserts the full dashboard, resource counts, materials, and recent logs (last 7 days).' });

        const cmd2 = cmdList.createEl('li');
        cmd2.createEl('strong', { text: 'Insert Caravan Logs Range: ' });
        cmd2.createSpan({ text: 'Prompts for a start and end day, then inserts log entries for that period.' });

        const cmd3 = cmdList.createEl('li');
        cmd3.createEl('strong', { text: 'Send Selection to Initiative: ' });
        cmd3.createSpan({ text: 'Parses selected text for monsters/NPCs and sends them to the Wildshape Tracker (Active or New).' });
    }
}
// ...

class CaravanIdModal extends Modal {
    result: string;
    onSubmit: (result: string | null) => void;

    constructor(app: App, onSubmit: (result: string | null) => void) {
        super(app);
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Enter Caravan ID" });

        const input = contentEl.createEl("input", { type: "text" });
        input.style.width = "100%";
        input.placeholder = "Paste your Caravan ID here...";

        const submitButton = contentEl.createEl("button", { text: "Submit" });
        submitButton.style.marginTop = "1rem";

        submitButton.addEventListener("click", () => {
            if (input.value) {
                this.onSubmit(input.value.trim());
                this.close();
            }
        });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && input.value) {
                this.onSubmit(input.value.trim());
                this.close();
            }
        });
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
        if (this.onSubmit) {
            this.onSubmit(null);
        }
    }
}

class CaravanLogRangeModal extends Modal {
    maxDay: number;
    onSubmit: (min: number, max: number) => void;

    constructor(app: App, maxDay: number, onSubmit: (min: number, max: number) => void) {
        super(app);
        this.maxDay = maxDay;
        this.onSubmit = onSubmit;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Select Log Range" });

        const container = contentEl.createDiv({ cls: 'setting-item' });
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '10px';

        // From
        const fromDiv = container.createDiv();
        fromDiv.createSpan({ text: "From Day: " });
        const fromInput = fromDiv.createEl("input", { type: "number" });
        fromInput.value = "1";
        fromInput.min = "1";
        fromInput.max = this.maxDay.toString();

        // To
        const toDiv = container.createDiv();
        toDiv.createSpan({ text: "To Day: " });
        const toInput = toDiv.createEl("input", { type: "number" });
        toInput.value = this.maxDay.toString();
        toInput.min = "1";
        toInput.max = this.maxDay.toString();

        const submitButton = contentEl.createEl("button", { text: "Fetch Logs" });
        submitButton.style.marginTop = "1rem";
        submitButton.addClass("mod-cta");

        submitButton.addEventListener("click", () => {
            const min = parseInt(fromInput.value);
            const max = parseInt(toInput.value);
            if (min > max) {
                new Notice("Start day cannot be after end day.");
                return;
            }
            this.onSubmit(min, max);
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
