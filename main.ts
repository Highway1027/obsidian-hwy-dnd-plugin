// main.ts
// v2 - Cleaned template and added settings tab and initial command.
import { App, Notice, Plugin, PluginSettingTab, Setting } from 'obsidian';

// Define the settings that our plugin will store.
interface HwysDnDToolsSettings {
	apiToken: string;
}

// Set the default values for the settings.
const DEFAULT_SETTINGS: HwysDnDToolsSettings = {
	apiToken: ''
}

// This is the main class for our plugin.
export default class HwysDnDToolsPlugin extends Plugin {
	settings: HwysDnDToolsSettings;

	// This function runs when the plugin is first loaded.
	async onload() {
		// Load any saved settings from memory.
		await this.loadSettings();

		// This adds a command to the command palette.
		this.addCommand({
			id: 'insert-caravan-status',
			name: 'Insert Caravan Status',
			callback: () => {
				// This is what will run when the user triggers the command.
				// For now, it just creates a simple notice.
				// Later, this will call our Firebase API.
				new Notice('Fetching Caravan Status...');
			}
		});

		// This adds a settings tab so the user can configure the plugin.
		this.addSettingTab(new HwysDnDToolsSettingTab(this.app, this));
	}

	// This function runs when the plugin is disabled.
	onunload() {

	}

	// This function loads the plugin's settings.
	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	// This function saves the plugin's settings.
	async saveSettings() {
		await this.saveData(this.settings);
	}
}


// This class defines the UI for our settings tab.
class HwysDnDToolsSettingTab extends PluginSettingTab {
	plugin: HwysDnDToolsPlugin;

	constructor(app: App, plugin: HwysDnDToolsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	// This function creates the HTML elements for the settings tab.
	display(): void {
		const {containerEl} = this;

		// Clear any old settings from the screen.
		containerEl.empty();

		// Add a heading for our settings section.
		containerEl.createEl('h2', {text: 'Highway DnD Tools Settings'});

		// Add the setting for the API Token.
		new Setting(containerEl)
			.setName('API Token')
			.setDesc('Paste your personal API token generated from the Highway DnD Tools website.')
			.addText(text => text
				.setPlaceholder('Enter your API token')
				.setValue(this.plugin.settings.apiToken)
				.onChange(async (value) => {
					// When the user types in the box, update the setting and save it.
					this.plugin.settings.apiToken = value;
					await this.plugin.saveSettings();
				}));
	}
}