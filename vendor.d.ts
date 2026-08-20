/**
 * Types for the few things this repo's own suites need and which ship none, or
 * ship an incomplete set.
 *
 * Deliberately *not* referenced from any shipping file, for the reason
 * `artifact-secrets/vendor.d.ts` states: a consumer that type-checks these
 * sources through a `file:` link already declares these names in its own vendor
 * file — `ArtifactPatform/vendor.d.ts` declares every one of them, and
 * `artifact-operator/vendor.d.ts` declares the globals — and a second ambient
 * declaration for one name is a duplicate the consumer cannot edit its way out
 * of. So this file covers this repo's own program only, and both consumers
 * needed no edit for the move or for the globals added since. What keeps that
 * true is that nothing a consumer compiles reaches this file: the modules are
 * named only from `test/`, and a consumer's program follows `lib/`.
 *
 * Nothing here declares `artifact-protocol`: it ships its own `.d.ts` set and
 * `exports` names them under a `types` condition, so `lib/chain.js` and
 * `lib/plan.js` are checked against the real thing. Nor `bare-fs` or
 * `bare-path`, which `test/chain.test.js` reaches for to read a sibling
 * capability's `declaration.js` off disk: both ship an `index.d.ts` their own
 * `exports` names, so that read is checked against the real thing too. The
 * shipping files still require neither — this repo requires nothing with a
 * socket, a store or a key in it, and nothing at all outside
 * `artifact-protocol`.
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

/**
 * `console` is a Bare global (bare-console), and the ES2022 lib with `types: []`
 * knows nothing about it. `log` only, and for exactly one caller: the loud skip
 * in `test/chain.test.js`'s `PLATFORM_VERSIONS` drift guard, which has to say
 * `# NOT MEASURED` on a checkout without the capability siblings beside it.
 * `error` is not here because nothing needs it; `ArtifactPatform/vendor.d.ts`
 * declares both, and this is the narrower half of that pair rather than a
 * divergence from it.
 */
declare const console: {
  log (...args: any[]): void
}

/**
 * Bare's CommonJS module wrapper supplies this, the same way Node's does. One
 * caller, in `test/`: the drift guard resolves `../platform-<segment>` relative
 * to itself, and there is no `import.meta.url` in a CJS file to derive it from.
 * `__filename` is not declared, for the reason `error` above is not.
 */
declare const __dirname: string
