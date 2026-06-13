import { Atom } from "effect/unstable/reactivity"
import { DiagnosticsLive } from "../services/diagnostics"

// Shared runtime for effect-backed atoms; holds the service layer so atoms built
// With runtime.fn / runtime.atom can reach Diagnostics and friends.
export const runtime = Atom.runtime(DiagnosticsLive)
