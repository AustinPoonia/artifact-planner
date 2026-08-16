/**
 * Is this graph valid? Answered from documents, completely, before anything runs.
 *
 * Every rule about how instances fit together used to be enforced at the moment
 * it happened to come up. `plan.js` threw on the first port it could not
 * resolve. `assemble.js` refused an instance after building it, needing a realm
 * to do so. `manifest.js` checked what one document could decide alone. Between
 * them they covered most of the ground, but only ever one problem at a time and
 * only ever on a device that had already fetched the artifacts, joined a swarm
 * and started building — so an admin composing network state found out their
 * wiring was wrong by signing it, deploying it, and watching a machine somewhere
 * fail to boot. Then they fixed one thing and did it again.
 *
 * This module is the same rules asked all at once, as a **pure function of
 * manifests and a plan**. No I/O, no swarm, no realm, no clock. That is not
 * tidiness: it is the whole feature. A verdict that needs a device is a verdict
 * an admin cannot get before signing, and a verdict that stops at the first
 * problem is a boot-and-retry loop with extra steps.
 *
 * ## What "the chain" is
 *
 * A contract may now state the contracts **anything providing it must itself
 * consume** (`manifest.contracts[].requires`). That is what makes contracts
 * chain: `permission` requires `groups`, so a permission instance must be able
 * to ask which groups a user is in, and if `groups` in turn required something
 * else, that would have to be reachable too. Before this, only *kinds* had
 * dependencies, so a chain existed in prose and was enforced nowhere.
 *
 * The closure is walked in full, and a problem at the far end is reported with
 * **the path that led there** — `macos.renderer -> web -> ...` — because the
 * instance an admin has to look at and the instance that is broken are usually
 * not the same one. Paths are computed once, breadth-first from the roots in
 * sorted order, so the path a problem carries is the shortest one and is the
 * same on every machine.
 *
 * ## Every problem, never the first
 *
 * Nothing here throws. It returns a list, and the list is complete: a graph with
 * nine faults reports nine, and a config object with four wrong keys reports
 * four — at every depth, with the path to each. `configProblems` used to be the
 * exception, because `contract.validate` stopped at the first bad key, which is
 * right for a door and wrong for a report. It worked around that a field at a
 * time and stated a nesting limit as the price. The limit is gone and the
 * workaround with it: `contract.faults` is the validator's own traversal,
 * accumulating, `contract.validate` is a wrapper over it that still throws the
 * first fault for the doors that want one, and this module asks for the list.
 * One walk, one set of rules, no two implementations to keep in agreement.
 *
 * Problems sort by instance, then port, then code, so two runs over the same
 * inputs produce the same bytes and a diff between two candidate graphs is
 * readable.
 *
 * ## Cycles are reported and are not errors
 *
 * A binding cycle is legal here and has always assembled; `assemble.js` argues
 * that at length and breaks the cycle deterministically. So a cycle is named in
 * `cycles` rather than counted as a problem — the requirement was that a loop is
 * *reported as a cycle* instead of discovered as a hang, and turning a shipped,
 * defended behaviour into a refusal would be this module deciding something it
 * was not asked to decide. What the walk guarantees is termination: every
 * traversal here is over a visited set, so a loop costs one pass and not a stack.
 *
 * A cycle in the *requirement* declarations is the same answer for a different
 * reason: contract C requiring D and D requiring C is satisfiable — two
 * instances pointing at each other satisfy it — so it is a cycle and not a
 * contradiction. Requirements are read one hop deep per instance and the
 * transitivity comes from every instance being checked, so no recursion over
 * declarations happens at all and there is nothing there to loop.
 *
 * ## One implementation of each rule
 *
 * `plan.js` used to carry the shape-substitution rule inline and `manifest.js`
 * carries the local half of the requirement rule. Both now defer here for the
 * parts that are shared — `visible` and `substitution` are exported and
 * `plan.js` imports them — because the failure this codebase keeps
 * rediscovering is two copies of one rule drifting apart, and a validator whose
 * answer differs from the boot path's is worse than no validator.
 *
 * `platformCheck` is exported on the same rule and for a sharper case of it. A
 * `platform:*` port names a range, and until it existed **nothing in the tree
 * asked whether that range could be met**: this module checked the contract was
 * one the runtime provides and stopped, and `assemble.js`'s `targetChecks`
 * answered a range no declaration satisfied with `null` — the value it also uses
 * for "no shape was worth checking here". So the two ways a wire can be
 * unverifiable had one spelling, and the unsafe one was the quiet one. The rule
 * is written once here, returns a tagged answer with no sentinel meaning
 * *unchecked*, and is meant to be called from both sides of the boundary; see
 * `PLATFORM_VERSIONS` for where the versions come from and what that costs.
 *
 * `boot.js` runs this between `plan` and `assemble`, so a device refuses the
 * same graph an admin's `artifact-operator network check` refused, with the same
 * words, for the same reasons.
 *
 * Both of those callers are in other repositories now — this file was
 * `ArtifactPatform/lib/chain.js` — and the sentence above is the reason the two
 * files moved together rather than one at a time. `index.js` has the argument.
 * Nothing about the rule changed: the kernel keeps a one-line re-export at the
 * old path so `boot.js` still spells it `./chain`, and `artifact-operator`
 * reaches the same code through the same subpath it always did.
 *
 * One reading note, for both files here. An unprefixed `boot.js`, `assemble.js`,
 * `native.js`, `document.js` or `sandbox.js` below means the **kernel's**, in
 * `artifact-platform`; an unprefixed `manifest.js` or `contract.js` means
 * `artifact-protocol`'s. The names are left as they were rather than rewritten
 * with prefixes, because these are the arguments those files' own headers answer
 * and a renamed cross-reference is a broken one the day somebody greps for it.
 *
 * ## What it still cannot say
 *
 * It reads declarations, so it inherits every limit declarations have.
 *
 *   - **Conformance.** Whether a provider actually implements the operations it
 *     claims needs the built instance's method list, which needs a realm.
 *     `assemble.js` owns that and always will; see `contract.js` on why not even
 *     arity survives into JS.
 *   - **Behaviour.** Two shapes agreeing is not two implementations agreeing.
 *     `compatible`'s header has the cents-for-dollars argument and it applies to
 *     every hop this module checks.
 *   - **The plan it is handed.** It validates a graph; it does not derive one.
 *     A graph `plan.js` refused to derive never reaches here, and the ambiguity
 *     errors that refusal produces are still `plan.js`'s alone.
 *
 * So a clean verdict means: this graph is wired the way its documents say it
 * should be. It does not mean the code behind those documents works.
 */
const { version: semver, contract, kernel } = require('artifact-protocol')

/** @typedef {import('artifact-protocol/manifest').Manifest} Manifest */
/** @typedef {import('artifact-protocol/contract').Shape} Shape */

/**
 * One instance, as the planner derives it and the assembler is handed it.
 *
 * `config` is plain JSON data, checked against the kind's declared schema before
 * it crosses into the realm. It is typed as an object rather than `unknown`
 * because a kind's schema is required to be an object schema — config is a set
 * of named settings, and there is no other shape it is allowed to take.
 *
 * ## Why the declaration is here
 *
 * It was `ArtifactPatform/lib/assemble.js`'s, and this file aliased it. That was
 * the consumer declaring the producer's vocabulary, and the split made the cost
 * of it concrete: an alias cannot cross a package boundary in a
 * `module.exports = <expression>` file without colliding with the declaration it
 * aliases (`index.js` has the account), and pointing this file at the kernel's
 * `assemble.js` would make a pure library type-depend on the runtime it exists
 * to be checkable without.
 *
 * So it is declared once, on the producing side, and `assemble.js` names it
 * through `artifact-planner/chain`. The direction now matches the values: the
 * kernel plans, then validates, then assembles, and every arrow points the same
 * way. `bindings` is optional because a hand-written spec — a test's literal, an
 * embedder's call to `assemble` — may omit it; `plan.js`'s `Planned` is this
 * type with `bindings` made present, which is the difference between what a
 * caller may write and what a derivation always produces.
 *
 * It sits in `chain.js` rather than `plan.js` for the reason `NATIVE` below
 * does: this is the module that owns what both halves read, and `plan.js`
 * already imports from here rather than the other way round.
 *
 * @typedef {object} InstanceSpec
 * @property {string} id
 * @property {string} artifact                       which loaded artifact to run
 * @property {string} [kind]                         which kind in it; defaults to the only one
 * @property {Record<string, unknown>} [config]
 * @property {Record<string, string | string[]>} [bindings]   port name -> target id(s)
 */

/**
 * Which native target fills a `platform:*` port.
 *
 * It lives here rather than in `plan.js` because "which contracts the runtime
 * itself provides" is a rule about what a valid graph may name, and this is the
 * module that owns those. `plan.js` re-exports it, so nothing outside had to
 * learn a new import.
 *
 * Scoping is part of the mapping rather than something an artifact asks for:
 * feeds and blobs are per *artifact* because two instances of one artifact are
 * two copies of the same program and have to see the same stream, while a store
 * is per *instance* because it is private working state and sharing it would be
 * a channel between instances that are supposed to be strangers.
 *
 * **And an unscoped row is a decision too, which `platform:diagnostics` is the
 * entry that makes plain.** The three unscoped rows are unscoped for three
 * different reasons and it is worth separating them, because "no scope" reads like
 * the absence of a decision and is not. `@network-view` is unscoped and still
 * per-network, because the kernel mints one per realm and the realm is the
 * partition. `@host` is unscoped and genuinely device-wide, because there is one
 * `PATH` and one shell profile. `@diagnostics` is unscoped and device-wide because
 * **the substrate admits no partition to expose**: the kernel's journal is one ring
 * per process, created before any network is joined, so a scoped token here would
 * promise a division that does not exist. That is the honest reason and it is also
 * the disclosure — an artifact holding it counts events belonging to networks it
 * cannot otherwise see — which `platform-diagnostics`' own declaration states,
 * because the party that has to know is the caller.
 *
 * ## The token is the contract's own final segment, mechanically
 *
 * `@` plus whatever follows `platform:`, with no abbreviation anywhere. That rule
 * is new and it replaces no rule at all: four of these shortened nothing
 * (`@store`, `@host`, `@feed`, `@blobs`) and two shortened something
 * (`platform:documentation → @docs`, `platform:network-view → @view`), so there
 * was a convention four entries wide and two exceptions to it, which is how a
 * convention stops being checkable.
 *
 * The exceptions were not free. `boot.js` parses a target back into a bare token
 * and switches on it, so after the `@` comes off, `docs` and `view` are living in
 * the same string space as artifact names, kind keys, port names and derived
 * instance ids — and both of them collided there. `docs` is the name of an
 * artifact in this tree (`artifact-docs`, whose one kind derives the instance id
 * `docs` and whose one port is called `docs`). `view` is worse: it is a **contract
 * id** in this tree, declared by `artifact-ui` as `view@1.1.0` and provided by
 * `app` and `send`. Neither collision can break a program today, because nothing
 * compares a native token against a name — but `test/docs.test.js` already pays
 * for one of them, in a leak assertion that has to search for `@docs` and cannot
 * search for `docs`, with a comment explaining why an entry had to be dropped
 * from the list.
 *
 * Fixing only `@docs` was the cheaper option and was rejected. It leaves `@view`
 * as the sole survivor of the abbreviating habit, which is an exception with no
 * argument behind it — and an exception with no argument is what invites the next
 * abbreviation and the next collision. It would also have fixed the *lesser* of
 * the two: an artifact name is a name, and a contract id is what half this module
 * resolves against. The whole mapping is mechanical instead, so the rule is one
 * sentence, `@network-view` is a slightly longer string, and there is nothing left
 * to remember.
 *
 * What this does **not** claim to do is make a collision impossible. `@` is the
 * namespace and no artifact name, kind key or contract id may begin with one, so
 * the *prefixed* forms are already safe; the hazard is entirely in the stripped
 * token, and the honest statement is that a mechanical mapping removes
 * abbreviation as a cause of one rather than removing the string space they
 * share. Comparing `boot.js`'s switch against the prefixed form would remove the
 * rest, and is a change to that switch and not to this table.
 *
 * @type {Record<string, (ctx: { artifact: string, instance: string }) => string>}
 */
const NATIVE = {
  'platform:network-view': () => '@network-view',
  'platform:host': () => '@host',
  'platform:documentation': () => '@documentation',
  'platform:diagnostics': () => '@diagnostics',
  'platform:store': ({ instance }) => `@store:${instance}`,
  'platform:feed': ({ artifact }) => `@feed:${artifact}`,
  'platform:blobs': ({ artifact }) => `@blobs:${artifact}`
}

/**
 * Which versions of each capability the runtime publishes — the half of the
 * native table that decides whether a port's *range* can be met, as opposed to
 * whether its *contract* exists.
 *
 * ## What this closes, and it was a hole rather than a narrow answer
 *
 * `NATIVE` above answers "may a graph name this contract". Nothing answered "may
 * a graph name it *at this range*", and the two are not the same question: a port
 * asking `platform:diagnostics ^9.0.0` named a contract the runtime provides, so
 * `portProblems` said nothing, and `assemble.js`'s `targetChecks` then found no
 * declaration in range and returned `null` — which that function reads as
 * **unchecked**, not as missing. Measured before this table existed: a kind
 * declaring `platform:diagnostics ^9.0.0` and `platform:store >=3.0.0 <1.0.0`
 * validated with `ok: true` and an empty problem list, and `explain` printed "the
 * chain is valid". Every call an artifact then made across such a port had its
 * parameters and its return validated against nothing at all.
 *
 * That is why `platform:diagnostics` still publishes `1.0.0` beside `2.0.0`:
 * retiring it would have turned every `^1.0.0` port in the fleet into an
 * unchecked one silently. With this table a retirement is a **refusal that names
 * the range and the versions**, which is the answer an operator can act on.
 *
 * ## Why a table here rather than the composed set, and what that costs
 *
 * The authority on what a capability publishes is the capability's own repo, and
 * `ArtifactPatform/lib/capabilities.js` composes all seven. This package cannot
 * see either: it is a pure documents-in library, and `index.js` argues that
 * putting `file:../` links to the capability repos in this manifest is the
 * inversion the split exists to remove. `artifact-protocol` cannot carry them
 * either — `lib/capability.js` records that the dependency runs the other way and
 * that its `PLATFORM_CONTRACTS` was **removed rather than left answering an empty
 * list**, precisely because a lookup that answers "no declaration" for everything
 * reads as unchecked downstream.
 *
 * Rejected: a required third argument to `validate`, so the caller supplies the
 * composed set and this table never exists. It is the better end state and it is
 * not reachable in one change — `ArtifactPatform/lib/boot.js:1094` and
 * `artifact-operator/lib/check.js:179` are the two callers, both in other
 * repositories, and a signature they do not yet pass would have this module
 * reporting "I could not check" on every platform port of every real graph. So
 * the argument is *optional* and this is its default; see `validate`.
 *
 * Rejected: folding the versions into `NATIVE` as a second field. Its values are
 * mint functions and `ArtifactPatform/test/chain.test.js` drives every one of
 * them through `Object.values(chain.NATIVE).map((mint) => mint(...))`. Changing
 * the value shape breaks a suite in a repo this one must not edit, for no gain
 * over a table beside it.
 *
 * ponytail: this is a copy of a fact that lives in seven other repositories, so a
 * capability that publishes a new version and does not move this row makes this
 * module **refuse a range the device would have accepted** — a false refusal,
 * which is a different and louder failure than the silent pass it replaces, but
 * still wrong. It is bounded to the day a capability's version list changes, and
 * nothing here can detect that day. The upgrade path is the rejected argument
 * above: once both callers pass the composed table from
 * `ArtifactPatform/lib/capabilities.js`, this constant is deleted and the
 * duplication with it. Until then the guard is cross-repo and not local —
 * `ArtifactPatform/test/chain.test.js` already compares `chain.NATIVE` against
 * `capabilities.PLATFORM_CONTRACTS` and is where the version comparison belongs
 * too, because that suite is the only place in the tree that can see both lists.
 *
 * @type {Record<string, readonly string[]>}
 */
const PLATFORM_VERSIONS = {
  'platform:network-view': ['1.0.0'],
  'platform:host': ['1.0.0'],
  'platform:documentation': ['1.0.0'],
  // Two, and the older one is alive on purpose. `platform-diagnostics`'
  // declaration list is ascending and says so, because the resolver takes the
  // *first* satisfying entry and the lowest version in range is the weakest
  // shape a port promised to work against — the same baseline rule
  // `substitution` applies below. Order is load-bearing here for that reason.
  'platform:diagnostics': ['1.0.0', '2.0.0'],
  'platform:store': ['1.0.0'],
  'platform:feed': ['1.0.0'],
  'platform:blobs': ['1.0.0']
}

/**
 * Can this port's range be met by something the runtime actually publishes, and
 * if not, which of the two failures is it?
 *
 * The distinction is the point of the function, because the two are different
 * operator problems with different fixes and a single "no" would hide which one
 * is in front of them:
 *
 *   - **`PLATFORM_UNDECLARED`** — the runtime mints this capability and nothing
 *     states a version of it, so there is no shape to hold any call to. That is a
 *     platform build with a capability half-installed; no edit to the consuming
 *     manifest fixes it.
 *   - **`PLATFORM_VERSION_OUT_OF_RANGE`** — the capability is published and the
 *     port asked for versions of it that do not exist. That is one line in one
 *     manifest, and the message names both sides so the reader does not have to
 *     go looking for what is on offer.
 *
 * **There is deliberately no third answer meaning "unchecked".** That value is
 * what this function was written to delete: `assemble.js`'s `targetChecks`
 * returns `Checks | null` and reads `null` as *not worth checking*, so a range
 * nothing satisfied and a port nobody needed to check were the same word. A
 * caller of this gets `ok: true` with the versions it may use, or `ok: false`
 * with a sentence — and cannot spell "fine" without the versions to back it.
 *
 * `versions` comes back **in the order it was offered**, not sorted and not
 * reduced to one. `targetChecks` resolves a shape with `.find`, which is the
 * first satisfying entry of an ascending list; handing back the filtered list in
 * that order means `[0]` is exactly what `.find` gave it, and means a caller that
 * wants the newest can still have it without this function choosing for
 * everybody.
 *
 * Exported for the reason `visible` and `substitution` are: `assemble.js` has to
 * reach the same verdict on the same facts, and this codebase's recurring failure
 * is two copies of one rule drifting until the validator disagrees with the boot
 * path. It is a pure function of three values so that the assembler — which has a
 * realm, a native and a composed capability table this package cannot see — can
 * call it with what it has.
 *
 * The **local** `satisfies` rather than the protocol's, for `depProblems`'
 * reason: a malformed range is a finding to report beside the others, not an
 * exception that abandons the verdict on every other instance. An unparseable
 * range therefore satisfies nothing and is reported as out of range, which names
 * the range in the message and is the honest reading — nothing published can meet
 * it, whether it is empty or unintelligible.
 *
 * @param {string} contract   the `platform:*` id the port names
 * @param {string} range      the range the port asked for
 * @param {readonly string[]} offered   every version the runtime publishes of it, in publication order
 * @returns {{ ok: true, versions: string[] } | { ok: false, code: 'PLATFORM_UNDECLARED' | 'PLATFORM_VERSION_OUT_OF_RANGE', why: string }}
 */
function platformCheck (contract, range, offered) {
  if (offered.length === 0) {
    return {
      ok: false,
      code: 'PLATFORM_UNDECLARED',
      why: `requires ${contract} ${range}, which this runtime provides and publishes no version of; ` +
        'there is no shape to hold a call against, so every call across the port would go unchecked'
    }
  }

  const versions = offered.filter((v) => satisfies(v, range))
  if (versions.length === 0) {
    return {
      ok: false,
      code: 'PLATFORM_VERSION_OUT_OF_RANGE',
      why: `wants ${contract} ${range}, and this runtime publishes ${[...offered].join(', ')}; ` +
        'no version in that range exists, so nothing could check a call across the port'
    }
  }

  return { ok: true, versions }
}

/**
 * One contract declaration, as `manifest.contracts[i]` holds it.
 *
 * @typedef {object} Declaration
 * @property {string} version
 * @property {Shape} [shape]
 * @property {{ contract: string, range: string }[]} [requires]
 */

/**
 * @typedef {object} Problem
 * @property {string} code       a stable machine name, so a caller can filter
 * @property {string} instance   the instance the fault is on
 * @property {string} port       the port it is on, or '' when it is not about one
 * @property {string[]} path     instance ids from a root to `instance`, inclusive
 * @property {string} message    the whole of it in one sentence, path included
 */

/**
 * @typedef {object} Verdict
 * @property {boolean} ok
 * @property {Problem[]} problems
 * @property {string[][]} cycles
 */

/** @param {string} a @param {string} b */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/** Every target a binding names, list or scalar, with `null` meaning none. */
const targetsOf = (/** @type {string | string[] | null | undefined} */ b) =>
  b === null || b === undefined ? [] : Array.isArray(b) ? b : [b]

/**
 * Validate a whole graph against the manifests behind it.
 *
 * `offered` is what the runtime publishes of each `platform:*` capability, and it
 * is the one input here that does not come out of a signed document — a
 * capability's versions are a property of the *build*, not of the network. It
 * defaults to `PLATFORM_VERSIONS`, whose header has the argument for a compiled-in
 * table and its ceiling; a caller that can see
 * `ArtifactPatform/lib/capabilities.js` should pass the composed set instead and
 * be right on a build this package was not compiled beside.
 *
 * Passing `{}` does not switch the check off. Every platform port then reports
 * `PLATFORM_UNDECLARED`, because a table that names no versions is a build in
 * which nothing can be checked, and saying so loudly is the whole point — an
 * empty table reading as a clean verdict is the exact failure
 * `artifact-protocol` removed its `PLATFORM_CONTRACTS` export to avoid.
 *
 * @param {Record<string, Manifest>} manifests
 * @param {readonly InstanceSpec[]} specs   what `plan()` derived
 * @param {Record<string, readonly string[]>} [offered]   versions the runtime publishes, by `platform:*` id
 * @returns {Verdict}
 */
function validate (manifests, specs, offered = PLATFORM_VERSIONS) {
  /** @type {Problem[]} */
  const problems = []

  const set = manifests === null || typeof manifests !== 'object' ? {} : manifests
  const all = [...(specs ?? [])].sort((a, b) => cmp(a.id, b.id))

  /** @type {Map<string, InstanceSpec>} */
  const byId = new Map()
  for (const s of all) {
    if (byId.has(s.id)) {
      problems.push(raw('DUPLICATE_INSTANCE', s.id, '', `two instances in this graph are both called ${s.id}`))
      continue
    }
    byId.set(s.id, s)
  }

  // Resolved once. Which declarations an artifact may be judged against is a
  // property of that artifact's own manifest and its deps, not of the port
  // being checked, and recomputing it per port would make a graph of tens of
  // instances walk every manifest hundreds of times.
  // The key a manifest is filed under has to be the name it gives itself, and
  // this is where that stops being an assumption.
  //
  // `visible` resolves a dep by writing `set[d.name]` — a *declared* name —
  // into a map `boot.js` fills with `manifests[want.artifact]`, the name the
  // network's signed state asked for. Those agree, and being sure of it takes
  // three checks in three other files: `release.verify` refuses a record whose
  // name is not the one requested, `source.fetch` is what requests, and
  // `bundle.js:82` refuses a drive whose manifest disagrees with its release.
  //
  // Three distant guards holding an invariant used here is how this stays true
  // by luck. Relax any one of them and `set[d.name]` starts missing — silently,
  // because a miss is indistinguishable from a dep the set does not include, so
  // the artifact would simply be judged against fewer declarations than it
  // actually has and every port would still validate. Checked rather than
  // trusted, and reported like any other problem: `validate` exists to hand back
  // every fault at once, and a set assembled wrong is a fault about the set.
  for (const key of Object.keys(set)) {
    const named = set[key]?.name
    if (named !== undefined && named !== key) {
      problems.push(raw('MISFILED_MANIFEST', '', '',
        `the manifest set files ${JSON.stringify(named)} under the key ${JSON.stringify(key)}; ` +
        'a dep is resolved by the name it declares, so every reference to either spelling would ' +
        'find the wrong manifest or none'))
    }
  }

  const declared = visible(set)
  const paths = reachability(all, byId)

  /** Every family tag claimed in this graph, and what each claimant says it means. */
  /** @type {Map<string, { instance: string, contract: string, canonical: string }[]>} */
  const families = new Map()

  /** Every (contract, surface, platform) claimed in this graph, and by whom. */
  /** @type {Map<string, { instance: string, contract: string, surface: string, platform: string }[]>} */
  const surfaces = new Map()

  // Built before the loop, unlike `families` and `surfaces` which are filled by
  // it. Those two ask whether the claimants agree, which is only answerable once
  // every claimant has been seen; this answers "does anybody in this graph supply
  // family X of contract C", which a port needs *while* it is being checked and
  // which no ordering of the instances makes available otherwise.
  const supply = familySupply(all, set)

  for (const spec of all) {
    const manifest = set[spec.artifact]
    if (manifest === undefined) {
      problems.push(raw('UNKNOWN_ARTIFACT', spec.id, '', `${spec.id} runs ${spec.artifact}, which is not in the manifest set`))
      continue
    }

    const kind = manifest.kinds.find((k) => k.key === spec.kind)
    if (kind === undefined) {
      problems.push(raw('UNKNOWN_KIND', spec.id, '', `${spec.id} names kind ${spec.kind}, which ${spec.artifact} does not have`))
      continue
    }

    configProblems(spec, kind, problems)
    depProblems(spec, manifest, set, problems)
    requirementProblems(spec, kind, byId, set, declared, problems)
    familyProblems(spec, kind, declared, families, problems)
    surfaceClaims(spec, kind, surfaces)
    portProblems(spec, kind, byId, set, declared, supply, offered ?? {}, problems)
  }

  // After the loop, because agreement between two providers is not a property
  // either of them has on its own.
  for (const [tag, seen] of families) {
    if (seen.length < 2) continue
    const odd = seen.filter((s) => s.canonical !== seen[0].canonical)
    if (odd.length === 0) continue
    for (const s of odd) {
      problems.push(raw('FAMILY_DISAGREEMENT', s.instance, '',
        `${s.instance} declares family ${JSON.stringify(tag)} for ${s.contract} with a different answer shape from ` +
        `${seen[0].instance}; a family tag is what a consumer switches on, so two providers wearing one tag and ` +
        'answering differently makes the tag mean nothing'))
    }
  }

  // Here for the same reason, one field over. Which instance a device hands its
  // command line to is decided by a surface and a platform, and two providers
  // claiming one pair is not something either manifest can see.
  //
  // `boot.js`'s `surfaceAdapter` refuses the same pair by name and both stay.
  // **This one is expected to fire first**: `boot` runs `validate` between `plan`
  // and `assemble`, and an admin's `network check` runs it before anything is
  // signed — so the pair is reported alongside every other fault in the graph
  // rather than one per boot, and reported to the person who composed it. The
  // one in `boot.js` is the backstop, because `surfaceAdapter` is called per
  // command against a live graph and a graph can be assembled by a caller that
  // never asked for a verdict. Two checks, one rule; the outer one exists so
  // that a throw on a device is never the first anybody hears of it.
  for (const [, seen] of [...surfaces].sort((a, b) => cmp(a[0], b[0]))) {
    if (seen.length < 2) continue
    // One problem per claimant, not one for the pair. There is no odd one out
    // here — `FAMILY_DISAGREEMENT` has a first claimant to measure the others
    // against, and this has nothing of the kind, because which of two adapters
    // came first is exactly the fact that must not decide anything. An admin
    // resolving it removes one of them, and either one is a real answer.
    for (const s of seen) {
      const others = seen.filter((o) => o !== s).map((o) => o.instance).sort(cmp)
      problems.push(raw('DUPLICATE_SURFACE', s.instance, '',
        `${s.instance} declares the ${s.surface} surface on ${s.platform} for ${s.contract}, and so does ` +
        `${others.join(' and ')}; a graph may hold one provider per surface and platform, and choosing ` +
        'between them would make which instance is handed a person\'s command line depend on iteration order'))
    }
  }

  for (const p of problems) {
    p.path = paths.get(p.instance) ?? [p.instance]
    if (p.path.length > 1) p.message += ` (reached by ${p.path.join(' -> ')})`
  }

  problems.sort((a, b) => cmp(a.instance, b.instance) || cmp(a.port, b.port) || cmp(a.code, b.code))

  return { ok: problems.length === 0, problems, cycles: cycles(all, byId) }
}

/** @param {string} code @param {string} instance @param {string} port @param {string} message @returns {Problem} */
const raw = (code, instance, port, message) => ({ code, instance, port, path: [instance], message })

/**
 * An artifact's `deps` ranges, against the versions this set actually holds.
 *
 * **Absent and present-and-wrong are different facts, and only one is a
 * problem.** A dep missing from the set is legitimate by design — AGENTS.md §3
 * says `deps` states what you may talk to and not what gets installed, and
 * `send` running without `qr` is the intended case — so refusing it would
 * enforce an install closure the planner deliberately does not walk. A dep
 * present at a version the author's own range excludes is the opposite: somebody
 * put that artifact in this network, it is the wrong one, and no deployment an
 * author was told to write for looks like that.
 *
 * The range was compared **nowhere** in this tree until now. Every other
 * `satisfies` call is against a *port's* range or a contract requirement's, both
 * of which are a different statement: the network's `base[].range` says which
 * versions a network ships and the author's `deps[].range` says which ones the
 * code was written against, and only the first was ever enforced. The failure
 * that made it concrete was an adapter binding to an older `artifact-cli` that
 * lacked operations it called, then dying with `deps.parser.plan is not a
 * function` when somebody typed a command — a runtime error for a fault visible
 * in two documents.
 *
 * Matched on the manifest's **own name**, not the key the set filed it under.
 * `assemble.js` says in as many words that a record key is whatever a plan chose
 * to call an artifact and need not equal the published name; `visible()` in this
 * file still resolves deps by key and therefore contributes nothing where the two
 * differ, which is a pre-existing inconsistency and not one to copy.
 *
 * The **local** `satisfies` rather than the protocol's, because this module is a
 * reporter over documents it did not verify: an unparseable range here is a
 * finding to report beside the others, not an exception that abandons the rest of
 * the verdict. `assemble.js` calls the throwing one for the opposite reason, and
 * both are right.
 *
 * `port` is the empty string — this is not about a contract, and `Problem.port`
 * already carries `''` elsewhere for the same reason.
 *
 * @param {any} spec @param {any} manifest
 * @param {Record<string, any>} set @param {any[]} out
 */
function depProblems (spec, manifest, set, out) {
  for (const dep of manifest.deps ?? []) {
    const loaded = Object.values(set).find((m) => m.name === dep.name)
    if (loaded === undefined) continue
    if (satisfies(loaded.version, dep.range)) continue

    out.push(raw('DEP_OUT_OF_RANGE', spec.id, '',
      `${spec.id} runs ${manifest.name}@${manifest.version}, which declares ${dep.name} ${dep.range}; ` +
      `this set has ${dep.name}@${loaded.version} — either the set is older than the artifact expects or ` +
      'the declaration asks for something never published here'))
  }
}

/**
 * An instance's config, against the schema its kind declared — every fault in it,
 * at every depth, with the path to each.
 *
 * The same two rules `assemble.js` applies, moved to where they can be answered
 * without building anything: config for a kind that declared no schema is a
 * setting nobody reads, and config for a kind that did has to satisfy it.
 *
 * ## One call, because the validator collects now
 *
 * This used to be a loop, and the loop existed for one reason:
 * `contract.validate` threw on the first thing it did not like. That is right for
 * a door and wrong for a report, so this function predicted the door instead of
 * asking it — a probe object `{ [key]: held[key] }` per unknown key, one
 * `validate` call per declared field, and a fallback to the whole-object refusal
 * for when the enumeration found nothing. To know what to loop over it also had
 * to decide for itself which of `values` and `fields` a schema meant, and it
 * stated the limit that followed: a field that was itself an object went in
 * whole, so two bad keys *inside* one nested object were one problem, and it was
 * the first of them.
 *
 * That reasoning was right about the constraint and wrong about the conclusion.
 * The constraint is real and is unchanged: the rules about what a schema means —
 * open vs closed, `values` vs `fields`, `optional` beside `nullable` — belong to
 * `contract.js`, and a second implementation of them here would be a checker
 * that can disagree with the door it is predicting, which is worse than no
 * checker. The conclusion drawn from it was that *this module* therefore had to
 * stop one level down. Wrong end: the validator had to stop throwing.
 *
 * `contract.faults` is that same traversal, accumulating, and
 * `contract.validate` is now three lines over it. So this is one call. The
 * agreement between this report and the device's door is no longer two
 * implementations that happen to match — it is one walk over one set of rules,
 * asked twice with a different question, and `faults[0].message` is by
 * construction the message `validate` throws. Everything that made this a loop
 * is deleted, including `refusal`, which existed only to turn a throw back into
 * a string.
 *
 * `{}` and not `spec.config`, matching `assemble.js` and `Sandbox.build`: a
 * schema whose fields are all optional is satisfied by an empty object, and the
 * value checked here has to be the value the realm receives — so an instance with
 * no config at all is still judged, and its required fields are still named.
 *
 * ## Ordering
 *
 * `faults` walks in document order and states that as part of its contract, and
 * `problems.sort` in `validate` is stable, so the faults of one config object
 * reach the reader in that order: unknown keys before declared fields, declared
 * fields in the order the schema declares them, elements by index, nested before
 * the next sibling. Rejected: adding the fault's path as a sort key so the
 * ordering could not depend on the traversal at all. It would be deterministic
 * either way — every fault of one object shares an instance, a port and a code,
 * and document order is already reproducible byte for byte — and sorting by path
 * would cost the property that makes this report worth reading first: the
 * earliest `BAD_CONFIG` on an instance is the message that instance's boot would
 * have died on.
 *
 * The `try` is not the old machinery in a new shape. `kind.config` is a parsed
 * `Schema` on every path through `manifest.js`, but this function is reachable
 * with a hand-built manifest that never went through it, and *nothing here
 * throws* is a promise this module makes at the top of the file to every caller
 * including `boot.js`. One guard around one call keeps it, and what it reports is
 * still what `assemble.js` would have said about the same schema.
 *
 * @param {InstanceSpec} spec
 * @param {Manifest['kinds'][number]} kind
 * @param {Problem[]} out
 */
function configProblems (spec, kind, out) {
  if (kind.config === undefined) {
    if (spec.config === undefined) return
    out.push(raw('UNDECLARED_CONFIG', spec.id, '',
      `${spec.id} is given config, but kind ${kind.key} of ${spec.artifact} declares no config schema; ` +
      'a setting the author never declared is one nothing reads'))
    return
  }

  const at = `${spec.id}.config`

  // `Fault` is the protocol's own type rather than a restatement of it, so a
  // change to the shape of a fault fails here at check time.
  /** @type {readonly import('artifact-protocol/contract').Fault[]} */
  let found
  try {
    found = contract.faults(spec.config ?? {}, kind.config, at)
  } catch (err) {
    found = [{ path: at, message: `${at} could not be checked: ${message(err)}` }]
  }

  for (const f of found) out.push(raw('BAD_CONFIG', spec.id, '', f.message))
}

/**
 * Whatever was thrown, as a sentence.
 *
 * `err instanceof Error` is not used and cannot be: a value thrown inside a
 * `bare-realm` carries that realm's `Error.prototype`, so the check is false for
 * a real error and the message would be thrown away exactly when it mattered.
 * Duck-typed instead.
 *
 * @param {unknown} err
 * @returns {string}
 */
function message (err) {
  const m = /** @type {{ message?: unknown }} */ (err)?.message
  return typeof m === 'string' && m.length > 0 ? m : String(err)
}

/**
 * What the contracts this instance provides demand of it in turn.
 *
 * Checked on the **provider** and not on whoever consumes it, which is what
 * makes the closure fall out for free: every provider is an instance in this
 * graph, so checking each instance against its own provided contracts covers
 * every hop of every chain, however deep, with no recursion over declarations
 * and therefore nothing to loop on.
 *
 * `manifest.js` already refuses the half one document can decide — a kind that
 * declares no port at all for a contract its own manifest says it must consume.
 * The rest needs the graph: the port has to actually be **bound**, and what it
 * is bound to has to provide the required contract at a version in range. An
 * `optional` port left empty satisfies nothing; a requirement is the contract's
 * author saying a provider without this cannot do the job, and cardinality is
 * the consuming kind's word about a port, not the declaring author's.
 *
 * @param {InstanceSpec} spec
 * @param {Manifest['kinds'][number]} kind
 * @param {Map<string, InstanceSpec>} byId
 * @param {Record<string, Manifest>} manifests
 * @param {Map<string, Map<string, Declaration[]>>} declared
 * @param {Problem[]} out
 */
function requirementProblems (spec, kind, byId, manifests, declared, out) {
  for (const provided of kind.provides) {
    const decl = (declared.get(spec.artifact)?.get(provided.id) ?? []).find((d) => d.version === provided.version)
    for (const need of decl?.requires ?? []) {
      const at = `${provided.id}@${provided.version}`
      const ports = kind.ports.filter((p) => p.contract === need.contract)

      if (ports.length === 0) {
        out.push(raw('UNMET_REQUIREMENT', spec.id, '',
          `${spec.id} provides ${at}, which requires its providers to consume ${need.contract} ${need.range}, ` +
          `and kind ${kind.key} declares no port for ${need.contract}`))
        continue
      }

      // Any one satisfying port is enough. A kind with two ports on one contract
      // has said the contract is reachable twice, and demanding both be bound
      // would read a requirement as a rule about port count.
      const bound = ports.flatMap((p) => targetsOf(spec.bindings?.[p.name]).map((t) => ({ port: p, target: t })))
      if (bound.length === 0) {
        out.push(raw('REQUIREMENT_UNBOUND', spec.id, ports[0].name,
          `${spec.id} provides ${at}, which requires its providers to consume ${need.contract} ${need.range}, ` +
          `and its ${ports.map((p) => p.name).join('/')} port is bound to nothing`))
        continue
      }

      const met = bound.some(({ target }) => {
        const t = byId.get(target)
        if (t === undefined) return false
        const tk = manifests[t.artifact]?.kinds.find((k) => k.key === t.kind)
        return (tk?.provides ?? []).some((p) => p.id === need.contract && satisfies(p.version, need.range))
      })

      if (!met) {
        out.push(raw('REQUIREMENT_VERSION', spec.id, ports[0].name,
          `${spec.id} provides ${at}, which requires its providers to consume ${need.contract} ${need.range}, ` +
          `and nothing its ${ports.map((p) => p.name).join('/')} port is bound to ` +
          `(${bound.map((b) => b.target).sort(cmp).join(', ')}) provides ${need.contract} in that range`))
      }
    }
  }
}

/**
 * A provider of a family-determined contract, against the declaration it is
 * providing — when that declaration lives in a dep and `manifest.parse` could
 * therefore not see it.
 *
 * `manifest.js` already decides this when a kind provides a contract its own
 * document declares: the family must be named and must type exactly the
 * operations the declaration left to it. `artifact-web` provides `renderer@2`
 * and `artifact-ui` declares it, which is the common arrangement and the one
 * that document could say nothing about. Same rule, one manifest further out.
 *
 * It also records every tag claimed, because the price of leaving families open
 * — and they are open by decision; closing them would make adding one a
 * breaking change to a contract its author does not own — is that two providers
 * could publish different answer shapes under one tag. Nothing local can see
 * that. This is the only place both declarations are in hand at once.
 *
 * @param {InstanceSpec} spec
 * @param {Manifest['kinds'][number]} kind
 * @param {Map<string, Map<string, Declaration[]>>} declared
 * @param {Map<string, { instance: string, contract: string, canonical: string }[]>} families
 * @param {Problem[]} out
 */
function familyProblems (spec, kind, declared, families, out) {
  for (const provided of kind.provides) {
    const decl = (declared.get(spec.artifact)?.get(provided.id) ?? []).find((d) => d.version === provided.version)
    const wants = decl?.shape?.family
    const says = provided.family
    const at = `${provided.id}@${provided.version}`

    if (wants === undefined) {
      // A declaration nothing in this set carries says nothing either way, and
      // is already reported as an unverifiable shape by `assemble.js` when it
      // matters. Only a *present* declaration that asked for no family makes a
      // provider's family a mistake.
      if (says !== undefined && decl?.shape !== undefined) {
        out.push(raw('UNWANTED_FAMILY', spec.id, '',
          `${spec.id} declares a family for ${at}, which does not say its return type is the family's; ` +
          'there is nothing for a family to decide'))
      }
      continue
    }

    if (says === undefined) {
      out.push(raw('MISSING_FAMILY', spec.id, '',
        `${spec.id} provides ${at}, whose return type is the family's, and does not say which family it is; ` +
        `nothing can check what its ${wants.returns.join(', ')} answers with`))
      continue
    }

    const want = [...wants.returns].sort(cmp)
    const got = Object.keys(says.returns).sort(cmp)
    if (want.join(',') !== got.join(',')) {
      out.push(raw('FAMILY_MISMATCH', spec.id, '',
        `${spec.id} declares family ${JSON.stringify(says.tag)} return types for ${got.join(', ') || '(none)'}, ` +
        `but ${at} leaves ${want.join(', ')} to the family`))
      continue
    }

    const list = families.get(says.tag) ?? []
    // Keyed by the tag alone and not by tag-and-contract, deliberately. A family
    // is a presentation type — `text@1` means the same thing wherever it is
    // claimed — and an adapter switching on a tag it read from one contract will
    // happily be handed a provider of another.
    list.push({ instance: spec.id, contract: at, canonical: JSON.stringify(sortDeep(says.returns)) })
    families.set(says.tag, list)
  }
}

/**
 * What each provider says it adapts, recorded for the cross-instance pass.
 *
 * Nothing here can be wrong on its own, so nothing is reported from it.
 * `manifest.parse` already holds each field to a closed set, and a provider
 * naming a surface and an OS is the whole point of the fields — it is only in
 * company that it becomes a fault. This is the `families` map's shape for the
 * `families` map's reason: agreement between two documents needs both.
 *
 * **Keyed by major version**, not by the exact `id@version` and not by the id
 * alone. `boot.js` resolves adapters through a caret range, so two instances
 * providing `kernel:surface-adapter@1.0.0` and `@1.2.0` are two answers to one
 * question and keying on the exact version would miss the pair a device
 * actually refuses. Keying on the id alone would go the other way and report
 * `@1` beside `@2`, which no single range resolves to both of. The honest limit:
 * a consumer pinning a range wider than one major would see an ambiguity this
 * pass does not name. No such consumer exists — `SURFACE_ADAPTER_RANGE` is
 * `^1.0.0` — and a range spanning majors is a different mistake.
 *
 * A malformed version keys under its own raw string rather than colliding with
 * everything else, matching `satisfies` below: a bad version in one manifest is
 * reported where versions are checked, not as a false pair here.
 *
 * @param {InstanceSpec} spec
 * @param {Manifest['kinds'][number]} kind
 * @param {Map<string, { instance: string, contract: string, surface: string, platform: string }[]>} surfaces
 */
function surfaceClaims (spec, kind, surfaces) {
  for (const provided of kind.provides) {
    const { surface, platform } = provided
    if (surface === undefined || platform === undefined) continue
    const contract = `${provided.id}@${major(provided.version)}`
    // NUL as the separator and spelled `\\0` rather than written as a raw byte,
    // for the reason `plan.js` gives at its own composite key: a raw NUL makes
    // `file(1)` call this source `data`, and then every plain `grep` over it
    // silently finds nothing. That is a worse bug than the ambiguity NUL fixes.
    const key = `${contract}\0${surface}\0${platform}`
    const list = surfaces.get(key) ?? []
    list.push({ instance: spec.id, contract, surface, platform })
    surfaces.set(key, list)
  }
}

/**
 * Who supplies which family of which contract, across the whole graph.
 *
 * The static counterpart to `plan.js`'s family filter. That filter answers "which
 * of these providers may fill this port"; this answers the question an admin
 * needs before signing anything — **is the family this port asks for on the
 * network at all**. They are separate because they fail at different moments and
 * only one of them is reachable before a device exists: a port whose family
 * nobody supplies is a `PlanError` on somebody's machine, and `network check`
 * exists so that it is a sentence on the admin's screen instead.
 *
 * Keyed by contract id and *not* by tag alone, which is the opposite of the
 * `families` map's key and deliberately so. That map asks whether two providers
 * wearing one tag mean the same thing by it, which is a question about the tag
 * across every contract that uses it. This one is resolving a port, and a port
 * names a contract — a `document@1` renderer is no use to a port on some other
 * contract that happens to have a `document@1` family too.
 *
 * A provider that declares no family is recorded with `family: undefined` rather
 * than skipped, so the report can distinguish "nothing provides this contract"
 * from "three things provide it and none of them said which family they are".
 * The second is a document bug somebody can fix; the first is a missing artifact.
 *
 * @param {readonly InstanceSpec[]} all
 * @param {Record<string, Manifest>} manifests
 * @returns {Map<string, { instance: string, version: string, family?: string }[]>}
 */
function familySupply (all, manifests) {
  /** @type {Map<string, { instance: string, version: string, family?: string }[]>} */
  const supply = new Map()

  for (const spec of all) {
    const kind = manifests[spec.artifact]?.kinds.find((k) => k.key === spec.kind)
    if (kind === undefined) continue // reported against `spec` itself
    for (const provided of kind.provides) {
      const list = supply.get(provided.id) ?? []
      list.push({ instance: spec.id, version: provided.version, family: provided.family?.tag })
      supply.set(provided.id, list)
    }
  }

  return supply
}

/**
 * Object keys sorted at every depth, so two declarations compare as data.
 *
 * @param {any} v
 * @returns {any}
 */
function sortDeep (v) {
  if (Array.isArray(v)) return v.map(sortDeep)
  if (v === null || typeof v !== 'object') return v
  /** @type {Record<string, any>} */ const out = {}
  for (const k of Object.keys(v).sort(cmp)) out[k] = sortDeep(v[k])
  return out
}

/**
 * Every port of one instance: bound to the right number of the right things.
 *
 * @param {InstanceSpec} spec
 * @param {Manifest['kinds'][number]} kind
 * @param {Map<string, InstanceSpec>} byId
 * @param {Record<string, Manifest>} manifests
 * @param {Map<string, Map<string, Declaration[]>>} declared
 * @param {Map<string, { instance: string, version: string, family?: string }[]>} supply
 * @param {Record<string, readonly string[]>} offered
 * @param {Problem[]} out
 */
function portProblems (spec, kind, byId, manifests, declared, supply, offered, out) {
  const bindings = spec.bindings ?? {}

  for (const port of kind.ports) {
    const has = Object.prototype.hasOwnProperty.call(bindings, port.name)
    const bound = has ? bindings[port.name] : undefined

    if (port.contract.startsWith('platform:')) {
      // Three answers and not two, because "this runtime has no such capability",
      // "it has one and publishes nothing" and "it publishes and none of it is in
      // range" send an operator to three different places. The first is the
      // contract question this branch always asked; the other two are the range
      // question it never did.
      if (NATIVE[port.contract] === undefined) {
        out.push(raw('UNKNOWN_PLATFORM_PORT', spec.id, port.name,
          `${spec.id}.${port.name} requires ${port.contract}, which this runtime does not provide`))
        // No range to ask about once the contract itself is unknown — asking
        // would report the same fault twice in two vocabularies.
        continue
      }

      // Asked whether or not the port is bound, like `NO_SUCH_FAMILY` above and
      // for the same reason: this is a question about what the runtime offers,
      // not about this wire. `plan.js` binds every platform port unconditionally,
      // so a bound-only check would be the same check with a hole in it the day
      // that changes.
      const met = platformCheck(port.contract, port.range, offered[port.contract] ?? [])
      if (!met.ok) out.push(raw(met.code, spec.id, port.name, `${spec.id}.${port.name} ${met.why}`))

      // A native target is a name the runtime mints (`@network-view`, `@store:x`) and is
      // not an instance in this graph, so nothing below applies to one.
      continue
    }

    // Asked before the binding is looked at, because it is a question about the
    // artifact set and not about this wire. A port whose family nobody supplies
    // is broken even when it is `optional` and therefore correctly unbound —
    // which is exactly the case no other check here can see, since an unbound
    // optional port is the absence the whole design is built on.
    if (port.family !== undefined) {
      const inRange = (supply.get(port.contract) ?? [])
        .filter((p) => p.instance !== spec.id && satisfies(p.version, port.range))
      if (!inRange.some((p) => p.family === port.family)) {
        const tags = [...new Set(inRange.map((p) => p.family ?? '(none declared)'))].sort(cmp)
        out.push(raw('NO_SUCH_FAMILY', spec.id, port.name,
          `${spec.id}.${port.name} wants ${port.contract} ${port.range} in family ${JSON.stringify(port.family)}, ` +
          (inRange.length === 0
            ? 'and nothing in this graph provides that contract at all'
            : `and nothing provides that family — ${inRange.map((p) => p.instance).sort(cmp).join(', ')} ` +
              `offer${inRange.length === 1 ? 's' : ''} ${tags.join(', ')}`)))
      }
    }

    if (Array.isArray(bound) !== (port.cardinality === 'many')) {
      if (port.cardinality === 'many') {
        out.push(raw('WRONG_ARITY', spec.id, port.name,
          `${spec.id}.${port.name} takes a list of ${port.contract} and is bound to ${has ? 'a single target' : 'nothing'}`))
        continue
      }
      if (Array.isArray(bound)) {
        out.push(raw('WRONG_ARITY', spec.id, port.name,
          `${spec.id}.${port.name} takes ${port.cardinality === 'one' ? 'exactly one' : 'at most one'} ` +
          `${port.contract} and is bound to a list of ${bound.length}`))
        continue
      }
    }

    const targets = targetsOf(bound)

    if (targets.length === 0) {
      if (port.cardinality === 'one') {
        out.push(raw('UNBOUND_REQUIRED', spec.id, port.name,
          `${spec.id}.${port.name} requires ${port.contract} ${port.range} and is bound to nothing`))
      }
      // `optional` unbound is the absence the whole design is built on, and an
      // empty `many` is a consumer with nothing in it rather than a fault.
      continue
    }

    for (const target of targets) {
      const t = byId.get(target)
      if (t === undefined) {
        out.push(raw('UNKNOWN_TARGET', spec.id, port.name,
          `${spec.id}.${port.name} is bound to ${target}, which is not an instance in this graph`))
        continue
      }

      const tkind = manifests[t.artifact]?.kinds.find((k) => k.key === t.kind)
      if (tkind === undefined) continue // already reported against `t` itself

      const offers = tkind.provides.filter((p) => p.id === port.contract)
      if (offers.length === 0) {
        out.push(raw('NOT_A_PROVIDER', spec.id, port.name,
          `${spec.id}.${port.name} wants ${port.contract} and is bound to ${target}, ` +
          `which provides ${tkind.provides.map((p) => `${p.id}@${p.version}`).sort(cmp).join(', ') || 'nothing'}`))
        continue
      }

      const inRange = offers.filter((p) => satisfies(p.version, port.range))
      if (inRange.length === 0) {
        out.push(raw('VERSION_OUT_OF_RANGE', spec.id, port.name,
          `${spec.id}.${port.name} wants ${port.contract} ${port.range} and is bound to ${target}, ` +
          `which provides ${offers.map((p) => p.version).sort(cmp).join(', ')}`))
        continue
      }

      // The family of the thing actually on the other end. `plan.js` cannot
      // produce this fault — its filter ran before it chose — so everything this
      // catches arrives by the route `plan.js` deliberately does not touch: an
      // admin naming a target by hand. That is the same argument the substitution
      // check below makes for running on explicit bindings. Naming a target is
      // deciding which instance; it is not waiving what the port asked for.
      if (port.family !== undefined && !inRange.some((p) => p.family?.tag === port.family)) {
        const got = [...new Set(inRange.map((p) => p.family?.tag ?? '(none declared)'))].sort(cmp)
        out.push(raw('WRONG_FAMILY', spec.id, port.name,
          `${spec.id}.${port.name} wants ${port.contract} in family ${JSON.stringify(port.family)} and is bound to ` +
          `${target}, which provides it in ${got.join(', ')}; a family tag is what the consumer switches on, so a ` +
          'binding across families hands it an answer shape it did not agree to read'))
        continue
      }

      // The hop, checked as a substitution rather than as two numbers matching.
      // This runs on **every** binding, including the explicit ones `plan.js`
      // deliberately leaves alone: an admin naming a target by hand is the admin
      // deciding which instance, not the admin waiving what a range means.
      for (const offered of inRange) {
        // The *consumer's* artifact, always. Which declarations of a contract
        // count is a property of who is doing the calling — its own manifest
        // plus its deps — and reading the provider's vocabulary here would hold
        // a consumer to a shape its author never saw.
        const bad = substitution(spec.artifact, port, offered.version, declared)
        if (bad === null) continue
        out.push(raw('INCOMPATIBLE_SHAPE', spec.id, port.name,
          `${spec.id}.${port.name} is bound to ${target}, which provides ${port.contract}@${offered.version}; ` +
          `that cannot stand in for ${port.contract}@${bad.baseline}, the lowest version ${port.range} admits and ` +
          `so the weakest shape this port promised to work against — ${bad.problems.join('; ')}`))
      }
    }
  }
}

/**
 * Whether a provider's declared shape can stand in for the weakest one a port's
 * range commits its consumer to. `null` means yes, or means there was nothing to
 * compare — see `plan.js`'s header for why every absence is a pass and why the
 * baseline is the *lowest* satisfying declaration rather than the newest or the
 * provider's own.
 *
 * Exported so `plan.js` derives and this module validates against one rule
 * rather than two implementations of it.
 *
 * @param {string} consumer   the consuming artifact's name
 * @param {{ contract: string, range: string }} port
 * @param {string} version    the version the candidate provides
 * @param {Map<string, Map<string, Declaration[]>>} declared
 * @returns {{ baseline: string, problems: string[] } | null}
 */
function substitution (consumer, port, version, declared) {
  const versions = declared.get(consumer)?.get(port.contract)
  if (versions === undefined) return null

  /** @type {Declaration | null} */
  let baseline = null
  for (const d of versions) {
    if (!satisfies(d.version, port.range)) continue
    if (baseline === null || compare(d.version, baseline.version) < 0) baseline = d
  }

  const older = baseline?.shape
  if (baseline === null || older === undefined) return null

  const newer = versions.find((d) => d.version === version)?.shape
  if (newer === undefined) return null

  const { ok, problems } = contract.compatible(older, newer)
  return ok ? null : { baseline: baseline.version, problems }
}

/**
 * What each artifact can see said about a contract: the platform's own
 * declarations, then its own, then those of the artifacts it named as deps, in
 * the order it named them.
 *
 * Scanning every manifest in the set instead would make the baseline depend on
 * who else the network happens to run — add an artifact declaring `C@0.9.0` and
 * every consumer of `C` is abruptly held to a shape its author never saw.
 * `plan.js`'s header has the long form; this is the same `deps` rule that says
 * a manifest is not an install instruction, read from the other side.
 *
 * ## The platform's declarations are seeded, because nobody else can carry them
 *
 * This function used to read `source.contracts` and nothing else, and that made
 * it **structurally incapable of resolving a `kernel:*` id** — not unlikely to,
 * unable to. `manifest.parse` refuses a manifest that declares one, so the single
 * place this walk looked was guaranteed empty for a whole namespace, and every
 * caller got a silent `undefined` that reads exactly like "nothing declared this"
 * rather than "nothing was allowed to".
 *
 * What that cost was not theoretical. `requirementProblems` could never fire for
 * a `kernel:` contract, `familyProblems` could never fire, and `substitution`
 * returned `null` for any port on one — so a graph binding a `kernel:` port got
 * no version-substitution check at all. Three rules quietly not applying to one
 * namespace, none of them saying so.
 *
 * `artifact-protocol/lib/kernel.js` holds those declarations, so every artifact
 * is seeded with them before its own manifest is read. Seeded **first**, and the
 * order is the rule that already governs this map: first writer of an
 * `id@version` wins, and the platform's declaration of a contract the platform
 * consumes is not something a dep gets to shadow. Nothing can collide with it in
 * practice either — an artifact carrying a `kernel:` declaration does not parse.
 *
 * This is a read, not an injection. The declarations never enter a `Manifest`,
 * for the reason `assemble.js`'s `declaredShape` gives: `release.manifestHash()`
 * hashes the parsed manifest.
 *
 * @param {Record<string, Manifest>} manifests
 * @returns {Map<string, Map<string, Declaration[]>>}
 */
function visible (manifests) {
  /** @type {Map<string, Map<string, Declaration[]>>} */
  const byArtifact = new Map()

  for (const name of Object.keys(manifests)) {
    const manifest = manifests[name]
    /** @type {Map<string, Declaration[]>} */
    const seen = new Map()

    for (const decl of kernel.DECLARATIONS) {
      seen.set(decl.id, [...(seen.get(decl.id) ?? []), decl])
    }

    // `d.name` indexes a map keyed by the name the *network's signed state*
    // asked for (`boot.js`: `manifests[want.artifact]`), not by the name the
    // manifest gives itself. Those are the same string, and it takes three
    // checks in three files to be sure of it: `release.verify` refuses a record
    // whose `name` is not the one asked for, `source.fetch` is what asks, and
    // `bundle.js:82` refuses a drive whose manifest disagrees with its release.
    // Written down because the assumption is used here and guarded nowhere near
    // here — relax any one of those three and this lookup starts silently
    // missing, which reads as a dep the set does not include.
    for (const source of [manifest, ...manifest.deps.map((d) => manifests[d.name])]) {
      // A dep the network's set does not include contributes nothing. Whether
      // that absence is itself an error is `assemble.js`'s question.
      if (source === undefined) continue

      for (const decl of source.contracts) {
        const list = seen.get(decl.id) ?? []
        // Own manifest first, then deps in declared order, first wins. Two
        // artifacts declaring one `id@version` differently is a collision this
        // module cannot adjudicate; resolving it by iteration order at least
        // resolves it the same way on every device.
        if (!list.some((d) => d.version === decl.version)) list.push(decl)
        seen.set(decl.id, list)
      }
    }

    byArtifact.set(name, seen)
  }

  return byArtifact
}

/**
 * The shortest path from a root to every instance, so a problem can say how a
 * reader gets to it.
 *
 * Breadth-first from the instances nothing binds, taken in sorted order, then
 * from whatever is left — an instance can be unreachable from any root only by
 * being inside a cycle nothing outside points into, and it still needs a path.
 * Sorted at both steps because two devices validating one graph have to produce
 * one answer, and "whichever key the map yielded first" is not one.
 *
 * @param {readonly InstanceSpec[]} all
 * @param {Map<string, InstanceSpec>} byId
 * @returns {Map<string, string[]>}
 */
function reachability (all, byId) {
  const pointedAt = new Set()
  for (const s of all) {
    for (const b of Object.values(s.bindings ?? {})) {
      for (const t of targetsOf(b)) if (t !== s.id) pointedAt.add(t)
    }
  }

  /** @type {Map<string, string[]>} */
  const paths = new Map()
  /** @param {string[]} starts */
  const sweep = (starts) => {
    const queue = [...starts]
    for (const id of starts) if (!paths.has(id)) paths.set(id, [id])
    while (queue.length > 0) {
      const id = /** @type {string} */ (queue.shift())
      const here = /** @type {string[]} */ (paths.get(id))
      const spec = byId.get(id)
      if (spec === undefined) continue
      const next = Object.keys(spec.bindings ?? {}).sort(cmp)
        .flatMap((port) => targetsOf(spec.bindings?.[port]))
      for (const t of next) {
        if (paths.has(t) || !byId.has(t)) continue
        paths.set(t, [...here, t])
        queue.push(t)
      }
    }
  }

  sweep(all.filter((s) => !pointedAt.has(s.id)).map((s) => s.id))
  for (const s of all) if (!paths.has(s.id)) sweep([s.id])

  return paths
}

/**
 * Every binding cycle, each named once, smallest member first.
 *
 * Iterative depth-first with an explicit stack, because the thing being detected
 * is exactly the thing that would blow a recursive one. Reported rather than
 * refused: see the header.
 *
 * @param {readonly InstanceSpec[]} all
 * @param {Map<string, InstanceSpec>} byId
 * @returns {string[][]}
 */
function cycles (all, byId) {
  /** @type {Set<string>} */ const done = new Set()
  /** @type {string[][]} */ const found = []
  /** @type {Set<string>} */ const named = new Set()

  for (const root of all) {
    if (done.has(root.id)) continue

    /** @type {string[]} */ const stack = []
    /** @type {Set<string>} */ const onStack = new Set()
    /** @type {{ id: string, next: string[], at: number }[]} */
    const frames = [{ id: root.id, next: edges(byId, root.id), at: 0 }]
    stack.push(root.id)
    onStack.add(root.id)

    while (frames.length > 0) {
      const frame = frames[frames.length - 1]
      if (frame.at >= frame.next.length) {
        frames.pop()
        onStack.delete(/** @type {string} */ (stack.pop()))
        done.add(frame.id)
        continue
      }

      const t = frame.next[frame.at++]
      if (!byId.has(t)) continue

      if (onStack.has(t)) {
        const loop = stack.slice(stack.indexOf(t))
        // Rotated so the smallest id leads. The same cycle reached from three
        // different entry points is one cycle, and a reader comparing two runs
        // should not have to notice that.
        const lead = loop.indexOf([...loop].sort(cmp)[0])
        const rotated = [...loop.slice(lead), ...loop.slice(0, lead)]
        const key = rotated.join('>')
        if (!named.has(key)) { named.add(key); found.push(rotated) }
        continue
      }

      if (done.has(t)) continue
      frames.push({ id: t, next: edges(byId, t), at: 0 })
      stack.push(t)
      onStack.add(t)
    }
  }

  return found.sort((a, b) => cmp(a.join('>'), b.join('>')))
}

/** @param {Map<string, InstanceSpec>} byId @param {string} id */
function edges (byId, id) {
  const spec = byId.get(id)
  if (spec === undefined) return []
  return Object.keys(spec.bindings ?? {}).sort(cmp)
    .flatMap((port) => targetsOf(spec.bindings?.[port]))
    .filter((t) => t !== id)
}

/**
 * `satisfies` and `compare` that answer rather than throw.
 *
 * A malformed range in one manifest must not take out the verdict on every
 * other instance — this is a reporter, and `document.js` makes the same call for
 * the same reason. A range nothing can satisfy shows up as the port resolving to
 * nothing, which is a problem this module already names.
 *
 * @param {string} version @param {string} range
 */
function satisfies (version, range) {
  try {
    return semver.satisfies(version, range)
  } catch {
    return false
  }
}

/** @param {string} a @param {string} b */
function compare (a, b) {
  try {
    return semver.compare(a, b)
  } catch {
    return 0
  }
}

/** A version's major, or the version itself when it is not one. See `surfaceClaims`. */
function major (/** @type {string} */ version) {
  try {
    return String(semver.parseVersion(version).major)
  } catch {
    return version
  }
}

/**
 * The verdict as one string, for a caller that has to print it or throw it.
 *
 * @param {Verdict} verdict
 * @returns {string}
 */
function explain (verdict) {
  if (verdict.ok) return 'the chain is valid'
  return `${verdict.problems.length} problem${verdict.problems.length === 1 ? '' : 's'} in this graph:\n` +
    verdict.problems.map((p) => `  - ${p.message}`).join('\n')
}

module.exports = { validate, explain, visible, substitution, platformCheck, NATIVE, PLATFORM_VERSIONS }
