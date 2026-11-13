/**
 * Explicit state machines for Core records (issue #1329).
 *
 * A record's status changes only through a declared transition: the machine
 * lists every state and every event with the states it may leave from. A
 * domain store owns the status column and passes `transition()` a
 * compare-and-set writer, so a transition only lands if the row is still in
 * the state it was read in (no lost updates between concurrent requests).
 *
 * Side effects (creating a membership when an invite is accepted, and so on)
 * belong to the owning store, which runs them after a successful transition
 * and keeps them idempotent; D1 has no interactive transactions.
 */

type TransitionRule<State extends string> = {
  readonly from: readonly State[]
  readonly to: State
}

export type Machine<State extends string, Event extends string> = {
  readonly name: string
  readonly states: readonly State[]
  readonly initial: State
  /**
   * Other states a new row may be created in (an importer that records what
   * it found, say). Omit when every row starts at `initial`.
   */
  readonly entry?: readonly State[]
  /** States with no way out (accepted, revoked, ...). */
  readonly terminal: readonly State[]
  readonly transitions: { readonly [E in Event]: TransitionRule<State> }
}

export type NextState<State extends string> =
  | { readonly ok: true; readonly from: State; readonly to: State }
  | { readonly ok: false; readonly reason: "invalid_transition"; readonly message: string }

export type TransitionResult<State extends string> =
  | { readonly ok: true; readonly from: State; readonly to: State }
  | {
      readonly ok: false
      readonly reason: "not_found" | "invalid_transition" | "guard_rejected" | "conflict"
      readonly message: string
    }

/** Reads and conditionally writes one record's status column. */
export type StatusStore<State extends string> = {
  readonly read: (id: string) => Promise<State | null>
  /** Writes `to` only if the stored status is still `from`; true when written. */
  readonly compareAndSet: (id: string, from: State, to: State) => Promise<boolean>
}

/** Returns a null rejection, or a reason the transition must not happen. */
export type TransitionGuard<State extends string> = (from: State) => Promise<string | null> | string | null

export function defineMachine<const State extends string, const Event extends string>(
  machine: Machine<State, Event>,
): Machine<State, Event> {
  return machine
}

function eventsOf<State extends string, Event extends string>(machine: Machine<State, Event>): readonly Event[] {
  return Object.keys(machine.transitions).filter((key): key is Event => key in machine.transitions)
}

function ruleFor<State extends string, Event extends string>(
  machine: Machine<State, Event>,
  event: Event,
): TransitionRule<State> {
  return machine.transitions[event]
}

export function nextState<State extends string, Event extends string>(
  machine: Machine<State, Event>,
  from: State,
  event: Event,
): NextState<State> {
  const rule = ruleFor(machine, event)
  if (!rule.from.includes(from)) {
    return {
      ok: false,
      reason: "invalid_transition",
      message: `${machine.name}: "${event}" is not allowed from "${from}" (allowed from: ${rule.from.join(", ")})`,
    }
  }
  return { ok: true, from, to: rule.to }
}

export function availableEvents<State extends string, Event extends string>(
  machine: Machine<State, Event>,
  from: State,
): readonly Event[] {
  return eventsOf(machine).filter((event) => ruleFor(machine, event).from.includes(from))
}

/**
 * Structural problems in a machine definition: undeclared states, states that
 * cannot be reached from the initial state, terminal states with a way out,
 * and non-terminal dead ends. Every machine's test asserts this is empty.
 */
export function machineProblems<State extends string, Event extends string>(
  machine: Machine<State, Event>,
): readonly string[] {
  const problems: string[] = []
  const declared = new Set<string>(machine.states)
  if (declared.size !== machine.states.length) problems.push("states are listed more than once")
  if (!declared.has(machine.initial)) problems.push(`initial state "${machine.initial}" is not declared`)
  for (const state of machine.entry ?? []) {
    if (!declared.has(state)) problems.push(`entry state "${state}" is not declared`)
  }
  for (const state of machine.terminal) {
    if (!declared.has(state)) problems.push(`terminal state "${state}" is not declared`)
  }

  const events = eventsOf(machine)
  for (const event of events) {
    const rule = ruleFor(machine, event)
    if (rule.from.length === 0) problems.push(`event "${event}" has no source state`)
    for (const state of [...rule.from, rule.to]) {
      if (!declared.has(state)) problems.push(`event "${event}" uses undeclared state "${state}"`)
    }
  }

  const reached = new Set<string>([machine.initial, ...(machine.entry ?? [])])
  let grew = true
  while (grew) {
    grew = false
    for (const event of events) {
      const rule = ruleFor(machine, event)
      if (rule.from.some((state) => reached.has(state)) && !reached.has(rule.to)) {
        reached.add(rule.to)
        grew = true
      }
    }
  }
  const startsFrom = machine.entry?.length ? `"${machine.initial}" or an entry state` : `"${machine.initial}"`
  for (const state of machine.states) {
    if (!reached.has(state)) problems.push(`state "${state}" cannot be reached from ${startsFrom}`)
    const isTerminal = machine.terminal.includes(state)
    const exits = availableEvents(machine, state)
    if (isTerminal && exits.length > 0) problems.push(`terminal state "${state}" has outgoing events: ${exits.join(", ")}`)
    if (!isTerminal && exits.length === 0) problems.push(`state "${state}" is a dead end but not marked terminal`)
  }
  return problems
}

/** Moves one record through `event`, guarded and compare-and-set. */
export async function transition<State extends string, Event extends string>(
  machine: Machine<State, Event>,
  store: StatusStore<State>,
  id: string,
  event: Event,
  guard?: TransitionGuard<State>,
): Promise<TransitionResult<State>> {
  const from = await store.read(id)
  if (from === null) return { ok: false, reason: "not_found", message: `${machine.name}: ${id} not found` }

  const next = nextState(machine, from, event)
  if (!next.ok) return next

  const rejection = guard ? await guard(from) : null
  if (rejection !== null) return { ok: false, reason: "guard_rejected", message: rejection }

  const written = await store.compareAndSet(id, from, next.to)
  if (!written) {
    return {
      ok: false,
      reason: "conflict",
      message: `${machine.name}: ${id} changed from "${from}" before "${event}" could apply`,
    }
  }
  return next
}
