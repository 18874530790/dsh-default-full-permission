// Bring the session projection cache in step with the events appended by
// patch-sessions.cjs.
//
// The cache records a watermark (`seq`) per projection row. A row whose
// watermark is behind the log is replayed by the runtime, but a row still
// holding the old values surfaces a stale permission state in the UI until that
// replay happens. Rewriting the three permission rows to the target values with
// the new watermark makes the cache correct on its own.
//
// Usage:
//   node sync-projection-cache.cjs [--dry-run] [--force]
//
// Refuses to run while DeepSeek Harness is running (see _guard.cjs).
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { DSH_ROOT, assertAppClosed, requireDir } = require("./_guard.cjs");

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
const TARGET = { preset: "danger-full-access", sandbox: "danger-full-access", approval: "never" };

assertAppClosed(process.argv);

const DRY_RUN = process.argv.includes("--dry-run");
const SESSIONS = requireDir(path.join(DSH_ROOT, "sessions"), "session directory");
const CACHE = requireDir(
	path.join(DSH_ROOT, "storages", "session_projcache", "sessions"),
	"projection cache directory"
);

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
 * @param {string} file - Session log path.
 * @returns {string[]} JSON lines across all frames.
 */
function readLines(file) {
	const raw = fs.readFileSync(file);
	const idx = frameOffsets(raw);
	const lines = [];
	for (let k = 0; k < idx.length; k++) {
		const end = k + 1 < idx.length ? idx[k + 1] : raw.length;
		try {
			const text = zlib.zstdDecompressSync(raw.subarray(idx[k], end)).toString("utf8");
			for (const line of text.split("\n")) if (line) lines.push(line);
		} catch {}
	}
	return lines;
}

/**
 * Highest `seq` present in a session log.
 *
 * @param {string} file - Session log path.
 * @returns {number} The last sequence number, or -1 when the log has none.
 */
function maxSeq(file) {
	let max = -1;
	for (const line of readLines(file)) {
		let o;
		try {
			o = JSON.parse(line);
		} catch {
			continue;
		}
		if (typeof o.seq === "number" && o.seq > max) max = o.seq;
	}
	return max;
}

const seqById = new Map();
for (const bucket of fs.readdirSync(SESSIONS)) {
	const bucketPath = path.join(SESSIONS, bucket);
	if (!fs.statSync(bucketPath).isDirectory()) continue;
	for (const id of fs.readdirSync(bucketPath)) {
		const file = path.join(bucketPath, id, "session.v4.jsonl.zstd");
		if (fs.existsSync(file)) seqById.set(id, maxSeq(file));
	}
}

let updated = 0;

for (const entry of fs.readdirSync(CACHE)) {
	if (!entry.endsWith(".json")) continue;
	const id = entry.slice(0, -".json".length);
	const finalSeq = seqById.get(id);
	if (finalSeq === undefined) continue; // session no longer on disk

	const file = path.join(CACHE, entry);
	const doc = JSON.parse(fs.readFileSync(file, "utf8"));
	const rows = doc.record?.rows;
	if (!rows) continue;

	let touched = false;

	if (rows.sandboxMode && rows.sandboxMode.val !== TARGET.sandbox) {
		rows.sandboxMode = { ver: rows.sandboxMode.ver, seq: finalSeq, val: TARGET.sandbox };
		touched = true;
	}
	if (rows.approvalState && rows.approvalState.val?.policy !== TARGET.approval) {
		rows.approvalState = {
			ver: rows.approvalState.ver,
			seq: finalSeq,
			val: { ...rows.approvalState.val, policy: TARGET.approval },
		};
		touched = true;
	}
	if (rows.permissions) {
		const v = rows.permissions.val ?? {};
		if (v.preset !== TARGET.preset || v.sandbox !== TARGET.sandbox || v.approval !== TARGET.approval) {
			rows.permissions = {
				ver: rows.permissions.ver,
				seq: finalSeq,
				val: { ...v, preset: TARGET.preset, sandbox: TARGET.sandbox, approval: TARGET.approval },
			};
			touched = true;
		}
	}

	if (!touched) continue;

	if (DRY_RUN) {
		console.log(
			`[dry]  ${id.slice(0, 22)} would set watermark ${finalSeq} -> ${TARGET.preset}/${TARGET.approval}`
		);
		updated++;
		continue;
	}

	fs.writeFileSync(file, JSON.stringify(doc, null, 2));
	console.log(`[cache] ${id.slice(0, 22)} watermark -> ${finalSeq}, values -> ${TARGET.preset}/${TARGET.approval}`);
	updated++;
}

console.log(`\ncache files updated: ${updated}`);
