/**
 * Types for the two things this repo's own suites need and which ship none, or
 * ship an incomplete set.
 *
 * Deliberately *not* referenced from any shipping file, for the reason
 * `artifact-secrets/vendor.d.ts` states: a consumer that type-checks these
 * sources through a `file:` link already declares these modules in its own
 * vendor file — `ArtifactPatform/vendor.d.ts` declares both, line for line with
 * what is below — and a second ambient `declare module` for one specifier is a
 * duplicate the consumer cannot edit its way out of. So this file covers this
 * repo's own program only, and both consumers needed no edit for the move.
 *
 * Nothing here declares `artifact-protocol`: it ships its own `.d.ts` set and
 * `exports` names them under a `types` condition, so `lib/chain.js` and
 * `lib/plan.js` are checked against the real thing. That is the whole of the
 * vendor surface a pure documents-in/verdict-out library has, and it is worth
 * noticing — this repo requires nothing with a socket, a store or a key in it.
 */

/**
 * The test runner, at the three methods the suites use.
 *
 * `plan`, `pass`, `fail` — each suite collects its cases into an array, plans
 * the length and reports each one; the assertions themselves are
 * `bare-assert`'s. Copied narrow from `ArtifactPatform/vendor.d.ts` rather than
 * widened here, and for its stated reason: declaring `equal` or `subtest` as
 * well would invite a case to start using the runner's assertions, which report
 * a plan count and not a diff.
 */
declare module 'bare-tap' {
  class TAP {
    plan (n: number): void
    pass (message?: string): void
    fail (message?: string): void
  }
  const t: TAP
  export = t
}

/**
 * `bare-assert` *does* ship an `index.d.ts`, and it is incomplete: the runtime
 * exports `fail` and `notOk` and the declaration file lists neither. The two
 * suites here call `assert.fail` seven times and every one of those calls works
 * — the gap is in the types.
 *
 * An ambient declaration shadows the package's own types wholesale, which is a
 * bigger hammer than a module augmentation; augmenting an `export =` namespace
 * needs a second module-scoped `.d.ts`, and this repo keeps its vendor types in
 * one file, exactly as `ArtifactPatform` does. So the shadow is deliberate and
 * this copy is that one, unnarrowed: a looser copy of a declaration whose whole
 * job is to catch a mistyped assertion name would make the strict one pointless
 * on the path that matters.
 */
declare module 'bare-assert' {
  function assert (value: any, message?: string | Error): asserts value
  namespace assert {
    class AssertionError extends Error {
      constructor (opts?: { message?: string, actual?: any, expected?: any, operator?: string })
      actual?: any
      expected?: any
      operator?: string
    }
    function ok (value: any, message?: string | Error): asserts value
    function notOk (value: any, message?: string | Error): void
    function fail (message?: string | Error): void
    function equal (actual: any, expected: any, message?: string | Error): void
    function notEqual (actual: any, expected: any, message?: string | Error): void
    function strictEqual (actual: any, expected: any, message?: string | Error): void
    function notStrictEqual (actual: any, expected: any, message?: string | Error): void
  }
  export = assert
}
