/**
 * Default full permission, host half.
 *
 * DSH resolves a session's sandbox mode as
 * `request.mode ?? session override ?? deployment default`, and the approval
 * policy the same way. Every session therefore PINS the values it was created
 * with by appending `permission/preset`, `sandbox/mode` and `approval/policy`
 * events at seq 0-2. Because a session override outranks the deployment
 * default, changing `cordis.patch.yml` alone only affects sessions created
 * afterwards — existing ones keep their pinned `workspace-write` / `ask`.
 *
 * This plugin closes that gap. Once the permission and approval services are
 * live it appends the target override to every live agent's session, then
 * keeps doing so for each agent created later, so both existing and new
 * sessions resolve to the configured preset.
 *
 * It is deliberately idempotent: a session already sitting on the target
 * preset is left untouched, so restarting the app does not grow the log.
 */

/** The preset this plugin pins sessions to. */
const TARGET_PRESET = "danger-full-access";

/** Sandbox mode carried by {@link TARGET_PRESET}. */
const TARGET_SANDBOX = "danger-full-access";

/** Approval policy carried by {@link TARGET_PRESET}. */
const TARGET_APPROVAL = "never";

/**
 * Append one permission override to a session.
 *
 * The three events mirror what the shipped `permission` command writes, so the
 * projection folds them exactly as it folds a user-initiated switch. Only the
 * knobs that actually differ are appended; the preset marker goes first so a
 * partially applied write still leaves the session readable.
 *
 * @param {object} session - Live session owning the log.
 * @param {object} state - Folded permission state of that session.
 * @returns {boolean} Whether anything was appended.
 */
function pinSession(session, state) {
	const writes = [];
	if (state.preset !== TARGET_PRESET) writes.push(["permission/preset", { preset: TARGET_PRESET }]);
	if (state.sandbox !== TARGET_SANDBOX) writes.push(["sandbox/mode", { mode: TARGET_SANDBOX }]);
	if (state.approval !== TARGET_APPROVAL) writes.push(["approval/policy", { policy: TARGET_APPROVAL }]);
	for (const [type, data] of writes) session.append(type, data);
	return writes.length > 0;
}

/**
 * Cordis plugin.
 *
 * `permissionPresets` is injected because it owns the folded permission
 * projection and the `pinInitialPermission` step that seeds a fresh session;
 * running after it guarantees this override is the last word. `approval` is
 * injected so its service is mounted before any policy write, and `agents`
 * supplies the live list plus the creation event.
 *
 * @param {object} ctx - Plugin context.
 */
export default function defaultFullPermission(ctx) {
	ctx.inject(["permissionPresets", "approval", "agents"], (scope) => {
		/**
		 * Read the folded permission state of one session.
		 *
		 * `permission.permissionState` is the service's own accessor; it is
		 * preferred over re-folding the log here so this plugin can never drift
		 * from the authoritative projection.
		 *
		 * @param {object} session - Session to read.
		 * @returns {object} Folded state with `preset`, `sandbox`, `approval`.
		 */
		const stateOf = (session) => scope.permissionPresets.permissionState(session);

		/**
		 * Pin one session to the target preset, logging a failure rather than
		 * throwing: one unwritable session must not abort app startup.
		 *
		 * @param {object} session - Session to pin.
		 * @returns {void}
		 */
		const pin = (session) => {
			try {
				if (!pinSession(session, stateOf(session))) return;
				scope.logger.info(
					`default-full-permission: pinned ${session.id} to ${TARGET_PRESET}`
				);
			} catch (error) {
				scope.logger.warn(
					`default-full-permission: could not pin ${session?.id ?? "a session"}: ${
						error instanceof Error ? error.message : String(error)
					}`
				);
			}
		};

		// Register the creation listener before the sweep so a session created
		// during startup is not missed by both paths. No `prepend`: this must run
		// AFTER the built-in `pinInitialPermission` listener, which seeds a fresh
		// session's first three events, so the target values are the last word.
		scope.on("agent/created", ({ agent }) => pin(agent.session));

		// Then every agent that already exists, which covers resuming a session
		// and opening the app with live sessions restored.
		for (const agent of scope.agents.list()) pin(agent.session);
	});
}
