// Append the target permission overrides to every session that is not already
// on danger-full-access / never. Each session log is a sequence of independent
// zstd frames, so the patch appends new frames rather than rewriting the file.
//
// Usage:
//   node patch-sessions.cjs [--dry-run] [--force]
//
// Refuses to run while DeepSeek Harness is running (see _guard.cjs).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DSH_ROOT, assertAppClosed, requireDir } = require("./_guard.cjs");

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const TARGET = {
	preset: "danger-full-access",
	sandbox: "danger-full-access",
	approval: "never",
};

assertAppClosed(process.argv);

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = requireDir(path.join(DSH_ROOT, "sessions"), "session directory");

/** Byte offsets of every zstd frame header in a session log. */
function frameOffsets(raw) {
	const idx = [];
	let i = 0;
	while ((i = raw.indexOf(MAGIC, i)) !== -1) {
		idx.push(i);
		i += 4;
	}
	return idx;
}

/**
 * Decode every frame of a session log.
 *
 * `zlib.zstdDecompressSync` stops at the first frame, which is why the log is
 * split on the frame magic first instead of decompressed in one call.
 *
 * @param {string} file - Session log path.
 * @returns {string[]} JSON lines across all frames.
 */
function readFrames(file) {
	const raw = fs.readFileSync(file);
	const idx = frameOffsets(raw);
	const lines = [];
	for (let k = 0; k < idx.length; k++) {
		const end = k + 1 < idx.length ? idx[k + 1] : raw.length;
		try {
			const text = zlib.zstdDecompressSync(raw.subarray(idx[k], end)).toString("utf8");
			for (const line of text.split("\n")) if (line) lines.push(line);
		} catch (e) {
			console.log(`  [warn] frame ${k} failed: ${e.message}`);
		}
	}
	return lines;
}

/**
 * Fold a session's permission events into its current state.
 *
 * @param {string[]} lines - JSON lines of the session.
 * @returns {{preset: string|null, sandbox: string|null, approval: string|null, maxSeq: number}}
 */
function stateOf(lines) {
	let preset = null,
		sandbox = null,
		approval = null,
		maxSeq = -1;
	for (const line of lines) {
		let o;
		try {
			o = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof o.seq === "number" && o.seq > maxSeq) maxSeq = o.seq;
		if (o.type === "permission/preset") preset = o.data?.preset ?? preset;
		if (o.type === "sandbox/mode") sandbox = o.data?.mode ?? sandbox;
		if (o.type === "approval/policy") approval = o.data?.policy ?? approval;
	}
	return { preset, sandbox, approval, maxSeq };
}

const targets = [];
for (const bucket of fs.readdirSync(ROOT)) {
	const bucketPath = path.join(ROOT, bucket);
	if (!fs.statSync(bucketPath).isDirectory()) continue;
	for (const name of fs.readdirSync(bucketPath)) {
		const file = path.join(bucketPath, name, "session.v4.jsonl.zstd");
		if (fs.existsSync(file)) targets.push({ id: name, file });
	}
}

let patched = 0;
let skipped = 0;

for (const { id, file } of targets) {
	const lines = readFrames(file);
	const state = stateOf(lines);

	const writes = [];
	if (state.preset !== TARGET.preset) writes.push(["permission/preset", { preset: TARGET.preset }]);
	if (state.sandbox !== TARGET.sandbox) writes.push(["sandbox/mode", { mode: TARGET.sandbox }]);
	if (state.approval !== TARGET.approval) writes.push(["approval/policy", { policy: TARGET.approval }]);

	if (writes.length === 0) {
		console.log(`[skip] ${id.slice(0, 22)} already ${TARGET.preset}/${TARGET.approval}`);
		skipped++;
		continue;
	}

	// Build the new events, continuing the sequence after the last one.
	const appendLines = [];
	let seq = state.maxSeq;
	for (const [type, data] of writes) {
		seq += 1;
		appendLines.push(JSON.stringify({ type, seq, time: Date.now(), data }));
	}

	if (DRY_RUN) {
		console.log(
			`[dry]  ${id.slice(0, 22)} would append ${writes.length} events (seq ${state.maxSeq + 1}..${seq})`
		);
		patched++;
		continue;
	}

	const payload = zlib.zstdCompressSync(Buffer.from(appendLines.join("\n") + "\n", "utf8"));

	// Append rather than rewrite so the existing frames stay byte-identical.
	fs.appendFileSync(file, payload);

	console.log(
		`[done] ${id.slice(0, 22)} ${state.preset}/${state.approval} -> ${TARGET.preset}/${TARGET.approval} (+${writes.length} events, seq ${state.maxSeq + 1}..${seq})`
	);
	patched++;
}

console.log(`\npatched=${patched} skipped=${skipped} total=${targets.length}`);
