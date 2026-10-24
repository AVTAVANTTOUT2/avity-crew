# Native process reconciliation

`packages/supervisor/src/reconciliation.ts` supplies POSIX OS helpers only. It does not read Store, reassign attempts, resume a provider conversation, or infer failure from heartbeat age or silence. The runtime must journal the provider-turn intent and its observed identity, tied to the session, role and generation, before an explicitly authorized recovery action. Only identities recorded for the runtime's own detached provider groups may be passed to `stopOwnedProcess`; observing an arbitrary process does not establish domain ownership.

`observeProcess(pid)` invokes `/bin/ps` with explicit fields, full command width, C locale and UTC. It returns PID, native birth time, SHA256 of the native command representation, process group and observation time. Raw argv is never returned or included in exceptions. Missing/dead processes (including zombies) return null. An unavailable tool, timeout, oversized output or ambiguous snapshot raises `CrewError('RECONCILIATION_REQUIRED')`. Each inspection is bounded to 350 ms and 1 MiB.

`stopOwnedProcess(identity)` requires a detached group leader (`group_id === pid`), refuses the helper itself, its own process group and PID 1, and compares PID, birth, command hash and group before signaling. An identity mismatch or non-owned group raises `RECONCILIATION_REQUIRED` before any signal. A live verified group receives SIGTERM, then SIGKILL after 750 ms if necessary. The helper observes group membership until no live members remain, including when the parent has already exited and descendants have closed stdio. Zombies are dead, not writers. The entire shutdown has a 2750 ms inspection/poll budget; an inspection failure or surviving writer remains an explicit uncertain outcome. An uninterruptible kernel task can outlive SIGKILL and must not be reported stopped.

If the leader is already absent when recovery starts, a group without live members yields `already_exited`. A remaining live orphan yields `RECONCILIATION_REQUIRED`, without signaling: the leader's recorded birth/command can no longer be verified. There is no heuristic adoption of an orphan group. Once shutdown starts with a verified leader, losing the parent does not release the group early; escalation and member observation continue. A newly observed different leader before escalation is refused.

`ps` birth time has second precision; argv is a native textual representation and may change while a process runs. This is a conservative comparison, not an atomic kernel handle or a cryptographic ownership proof. PID reuse with a different birth/command/group is detected, but same-second reuse with identical representation and the final observation-to-signal race cannot be eliminated by portable `ps`. Process visibility must include the runtime's own children. Descendants which deliberately leave the recorded process group are outside this helper's guarantee. A reboot or uncertain journal/identity requires a domain recovery decision before reuse; no heartbeat timeout grants a new owner.

Windows is explicitly unsupported by these helpers; no equivalent process-tree guarantee is claimed. The tests exercise real detached child processes on the local POSIX host, forged identities, non-owned groups, restart from a serialized identity, normal exit, TERM-resistant parents/descendants, a real observed zombie and already-missing leaders. Linux and other POSIX implementations require their own qualification; the initial executed host is macOS. Provider LLM sessions and the runtime's persisted recovery workflow are not exercised by this OS-only suite.

## Runtime recovery and authority

The service journals `provider.turn` intent and the observed process identity with
the session, actor, role and generation. On service startup, it revokes prior
agent capabilities and marks unfinished provider operations for reconciliation.
It does not automatically restart those turns. An explicit resume, replacement
or reassignment must reconcile the recorded process before granting new ownership;
missing or ambiguous identity remains `RECONCILIATION_REQUIRED`.

Pause and stop prevent queued launches and wakeups while active processes are
being interrupted. The run becomes paused or cancelled only after their exits
are observed. A concurrent control receives `CONTROL_IN_PROGRESS`. Heartbeat age,
silence and a closed terminal never establish that a writer has stopped.

A native conversation is resumed by its exact recorded session ID when the
adapter supports it; there is no selection of the latest conversation. A chief
replacement uses a new authority generation and the durable project context,
without transferring the other provider's private conversation. Task amendments
also advance their generation. Mutations check current authority, attempt and
version at their effect, including requests which waited in a queue. Prior
handoffs and reviews cannot silently become evidence for a changed task.

The context compiler keeps current deliveries and new updates identifiable by
their sources. A native success event or process exit does not accept a task:
the stored delivery, independent review and verification of the current revision
remain necessary. See [usage](USAGE.md#reprendre-après-une-interruption),
[storage guards](STORAGE.md) and [configuration reload](INSTALLATION.md#configuration-avant-le-premier-lancement).
These runtime rules are distinct from the OS helper tests and from the final
native end-to-end recipe, which must identify its own candidate and evidence.
