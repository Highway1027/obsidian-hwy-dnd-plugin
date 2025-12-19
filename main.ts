// main.ts
// v8 - Fixed TypeScript error for 'unknown' value type in materials loop.
import { App, Notice, Plugin, PluginSettingTab, Setting, Modal, MarkdownView, requestUrl } from 'obsidian';

// Define the settings that our plugin will store.
interface HwysDnDToolsSettings {
    apiToken: string;
    defaultCaravanId: string;
}

// Set the default values for the settings.
const DEFAULT_SETTINGS: HwysDnDToolsSettings = {
    apiToken: '',
    defaultCaravanId: ''
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

                        // 3. Format Validation
                        let md = `### Caravan Logs (Day ${min} - ${max})\n\n`;
                        for (const log of logs) {
                            // Strip "Day X" / "Dag X" prefix if it exists in the body
                            // Regex looks for "Day 123" or "Dag 123" followed by punctuation or whitespace
                            let text: string = log.text;
                            const prefixRegex = /^(Day|Dag)\s+\d+[:.]?\s*/i;
                            text = text.replace(prefixRegex, "").trim();

                            md += `> [!example] Day ${log.day}\n> ${text}\n\n`;
                        }

                        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
                        if (activeView) {
                            activeView.editor.replaceSelection(md);
                            new Notice('Logs inserted!');
                        }
                    }).open();

                } catch (error) {
                    new Notice("Error fetching data: " + error.message);
                }
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
            md += `\n#### Recent Activity\n`;

            if (data.logSummary) {
                md += `> [!abstract] Weekly Summary\n> ${data.logSummary}\n\n`;
            }

            for (const log of data.recentLogs) {
                // Strip redundant "Day X"
                let text: string = log.text;
                const prefixRegex = /^(Day|Dag)\s+\d+[:.]?\s*/i;
                text = text.replace(prefixRegex, "").trim();

                md += `> [!example] Day ${log.day}\n> ${text}\n\n`;
            }
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
    }
}

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

