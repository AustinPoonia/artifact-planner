/**
 * artifact-planner — from a network's signed documents to a wired graph, and a
 * verdict on it, with nothing local in between.
 *
 * Two modules and one subject. `lib/plan.js` derives which instances a network
 * runs and what each one may reach, out of signed state and fetched manifests.
 * `lib/chain.js` answers whether the resulting graph is valid — every problem
 * rather than the first, each with the shortest path from a root. Both headers
 * carry the arguments; this file is only why they are a package.
 *
 * ## Why this is its own repository
 *
 * The rule `ArtifactPatform/scripts/all-repos.sh --check-doors` enforces: **a
 * module is a repo when something that is not its host imports it.**
 * `artifact-operator/lib/check.js` imported both of these by subpath —
 * `artifact-platform/lib/chain.js` and `artifact-platform/lib/plan.js` — and its
 * own comment there says why it reaches past the front door rather than through
 * it: the bare specifier loads the kernel's `index.js`, which drags `bare-realm`,
 * `corestore` and `hyperswarm` into every invocation of every verb. The reaching
 * was the evidence. This is the answer to it.
 *
 * What makes it answerable is that both files are **pure**: manifests and specs
 * in, a verdict or a binding out. No filesystem, no swarm, no realm, no clock,
 * nothing minted. Between them they require `artifact-protocol` and each other,
 * and that is the whole graph — `artifact-operator/test/guards.test.js` already
 * walked it transitively rather than trusting it, which is how it was known to be
 * true before the move rather than hoped after.
 *
 * ## Why the two move together
 *
 * Because splitting them would put one implementation of each shared rule in two
 * places, which is the failure this tree keeps removing. `lib/chain.js`'s header
 * says it: `visible`, `substitution` and `NATIVE` live there and `lib/plan.js`
 * imports them, so that the validator an admin runs before signing and the
 * derivation a device runs at boot cannot answer differently. A validator whose
 * answer differs from the boot path's is worse than no validator, and two repos
 * is the most reliable way there is to make two copies drift.
 *
 * ## It is not an artifact
 *
 * There is no `manifest.json`, no `build` and no ports. It is an ordinary Bare
 * module that the kernel and the operator both require directly, and it sits on
 * the far side of the boundary an artifact sees: it decides what an artifact's
 * `deps` will contain and is never reachable from inside one.
 *
 * ## Types come through `artifact-planner/chain` and `artifact-planner/plan`
 *
 * There is no `@typedef` in this file, and the absence is deliberate. This is a
 * `module.exports = <expression>` file, which TypeScript reads as `export =`; a
 * JSDoc typedef in such a file is not a named type export of it, and
 * re-declaring one as an alias of the declaration it points at collides with
 * that declaration the moment a consumer compiles both packages as one program
 * — `TS2300: Duplicate identifier`, invisible in this repo's own typecheck and
 * in the kernel's, reported only in the two repos that see both.
 * `artifact-net/lib/lan.js` has the full account; it cost a day there.
 *
 * So each type is declared exactly once, in the module that owns it, and a
 * consumer that needs to name one writes it against the subpath this package
 * declares — `import('artifact-planner/chain').InstanceSpec`,
 * `import('artifact-planner/chain').Verdict` — so `--check-doors` polices the
 * reference.
 */
module.exports = {
  chain: require('./lib/chain'),
  plan: require('./lib/plan').plan,
  PlanError: require('./lib/plan').PlanError
}
