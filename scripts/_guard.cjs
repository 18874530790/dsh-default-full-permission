// Refuse to touch session files while the app that owns them is running.
//
// The DSH desktop shell keeps session logs and the projection cache open. Both
// scripts below rewrite those files directly, so running one underneath a live
// app can desynchronise a session that is currently open. This module is the
// single place that decides whether it is safe to start.
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const HOME = process.env.USERPROFILE || process.env.HOME || "";

/** Default DSH data root for this platform; `DSH_HOME` overrides it. */
const DSH_ROOT = process.env.DSH_HOME || path.join(HOME, ".dsh");

/** Process names whose presence means the app is live and the files are in use. */
const BLOCKING_PROCESS_NAMES = ["DeepSeek Harness.exe", "dsh", "dsh.exe"];

/**
 * List the names of running processes, or an empty list when the platform has
 * no supported probe. Windows uses `tasklist`; POSIX systems use `ps`.
 *
 * @returns {string[]} Process names, possibly empty.
 */
function runningProcesses() {
	if (process.platform === "win32") {
		try {
			const out = execFileSync("tasklist", ["/FO", "CSV", "/NH"], {
				encoding: "utf8",
				windowsHide: true,
			});
			return out
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => line.split(",")[0].replace(/^"|"$/g, ""));
		} catch {
			return [];
		}
	}
	try {
		const out = execFileSync("ps", ["-eo", "comm="], { encoding: "utf8" });
		return out.split(/\r?\n/).filter(Boolean);
	} catch {
		return [];
	}
}

/**
 * Exit with status 2 when the app is running.
 *
 * Two documented escapes: `--dry-run` is read-only, so it is always allowed
 * (reading an open log is safe); `--force` is for a user who has confirmed the
 * app is closed but a stale process entry lingers.
 *
 * @param {string[]} argv - The script's `process.argv`.
 * @returns {void}
 */
function assertAppClosed(argv) {
	if (argv.includes("--dry-run") || argv.includes("--force")) return;

	const names = runningProcesses();
	const hit = names.filter((name) =>
		BLOCKING_PROCESS_NAMES.some((blocked) => name.toLowerCase() === blocked.toLowerCase())
	);

	if (hit.length === 0) return;

	console.error(
		[
			"",
			"Refusing to run: DeepSeek Harness is still running.",
			`  Detected: ${[...new Set(hit)].join(", ")}`,
			"",
			"Session logs and the projection cache are open by the running app,",
			"and rewriting them underneath it can corrupt a live session.",
			"",
			"Quit the app fully (Ctrl+Q, not the window close button), wait for",
			"every process to disappear, then run this again.",
			"",
			"To preview without writing anything, add --dry-run (always allowed).",
			"If you are certain it is closed and this is a stale entry:",
			"  node <script> --force",
			"",
		].join("\n")
	);
	process.exit(2);
}

/**
 * Exit with status 3 when a required directory is missing, so a wrong `DSH_HOME`
 * reports the mistake instead of silently succeeding on zero sessions.
 *
 * @param {string} dir - Directory that must exist.
 * @param {string} label - Human-readable name used in the error.
 * @returns {string} The same directory, for chaining.
 */
function requireDir(dir, label) {
	if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
		console.error(`Refusing to run: ${label} not found at ${dir}`);
		console.error("Set DSH_HOME if your DSH data lives somewhere else.");
		process.exit(3);
	}
	return dir;
}

module.exports = { DSH_ROOT, assertAppClosed, requireDir };
