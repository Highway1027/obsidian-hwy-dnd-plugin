// Copies the fresh build into Tim's Obsidian vault so hand tests run the newest code.
// Vault: OBSIDIAN_VAULT env var, else D:\Obsidian\highway-vault, else C:\Obsidian\highway-vault.
import { copyFileSync, existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

const files = ["main.js", "manifest.json", "styles.css"];
const vaults = [process.env.OBSIDIAN_VAULT, "D:\\Obsidian\\highway-vault", "C:\\Obsidian\\highway-vault"].filter(Boolean);
const vault = vaults.find((v) => existsSync(join(v, ".obsidian")));

if (!vault) {
	console.error(`No vault found (tried ${vaults.join(", ")}). Set OBSIDIAN_VAULT to the vault folder.`);
	process.exit(1);
}

const target = join(vault, ".obsidian", "plugins", "highway-dnd-tools");
if (!existsSync(target)) {
	console.error(`Plugin folder missing: ${target}. Install the plugin in Obsidian once first.`);
	process.exit(1);
}

for (const file of files) {
	copyFileSync(file, join(target, file));
	if (!readFileSync(file).equals(readFileSync(join(target, file)))) {
		console.error(`Copy check failed for ${file}`);
		process.exit(1);
	}
}

const { version } = JSON.parse(readFileSync("manifest.json", "utf8"));
const built = statSync("main.js").mtime.toLocaleString("nl-NL");
console.log(`Copied ${version} (main.js built ${built}) to ${target}. Reload the plugin in Obsidian.`);
