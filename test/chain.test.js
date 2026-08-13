/**
 * The static verdict, checked — including that it is a verdict and not a guess.
 *
 * Two properties matter more than any individual rule here and most of the file
 * is about them.
 *
 * **It reports everything.** A validator that stops at the first problem is the
 * boot-and-retry loop it was written to replace, so several cases deliberately
 * build a graph with many faults and assert on the count, not on the presence of
 * one message. `every problem` would pass trivially against a first-only
 * implementation if it only asserted that *a* problem was found.
 *
 * **It is not just refusing everything.** The negative is asserted as hard as
 * the positive: a valid four-deep chain must come back with an empty list, and a
 * valid adapter graph, an agreeing pair of families and a satisfied config
 * schema must each say nothing at all. A checker that says no to everything
 * catches every bug and is worthless.
 *
 * The chain fixtures go `a -> b -> c -> d` because three hops is the shortest
 * arrangement where "the problem is not where the reader is looking" is true:
 * with two, the path is the answer.
 *
 * ## What is here and what stayed in `artifact-platform`
 *
 * This file was `ArtifactPatform/test/chain.test.js` and it did not move whole,
 * which is worth stating rather than leaving to be noticed, because "the tests
 * came with the code" is the claim a split is normally judged on. Sixty-five of
 * its sixty-nine cases are below and four stayed, on one rule: **a case whose
 * subject is the kernel or the shipped artifact set belongs to the kernel.**
 *
 *   - three of them drive `boot.mintNatives` — the agreement between the
 *     `NATIVE` table here, the switch the kernel dispatches on, and the composed
 *     capability table in `ArtifactPatform/lib/capabilities.js`. Two of the three
 *     scrape the live kernel function with `Function.prototype.toString`, so they are
 *     about a file this repo must not require and cannot see. The third list used to
 *     be `capability.PLATFORM_CONTRACTS`; ROADMAP §6a is emptying that one, and the
 *     kernel's suite reads the composed set instead — which is also why the case
 *     below walks `NATIVE` rather than that export.
 *   - one validates the real manifests of seven shipped artifacts. Moving it
 *     would have put eight `file:../` links to artifact repos in this package's
 *     manifest, making a pure documents-in library depend on the concrete
 *     artifacts it exists to judge — the inversion the split is meant to remove,
 *     not a cycle but the same shape.
 *
 * So the division is the seam rather than a compromise: this suite proves the
 * rules, and `artifact-platform`'s remaining `test/chain.test.js` proves the
 * kernel and this module still answer as one. Neither half checks the other's
 * job, and the four that stayed reach this code through the kernel's own
 * re-export, so they also assert the door still opens.
 */
const t = require('bare-tap')
const assert = require('bare-assert')

const { manifest, capability } = require('artifact-protocol')
const chain = require('../lib/chain')
const { plan } = require('../lib/plan')

/**
 * Narrow a thrown value, loudly.
 *
 * `catch (err)` hands over `unknown`, and that is the truth: a `throw` can carry
 * anything. A cast would say "trust me" about the one thing a test should never
 * take on trust, and would read `undefined.message` on the day something threw a
 * string. This asserts instead, so a case whose failure stops carrying a message
 * fails *here*, naming what it got, rather than quietly matching a regex against
 * `undefined`.
 *
 * The check is duck-typed rather than `err instanceof Error`, and that is not
 * laziness — `instanceof` is the wrong question in this repo. An artifact's
 * factory runs inside a `bare-realm`, so an error it raises carries *that
 * realm's* `Error.prototype` and fails the host's `instanceof` while being an
 * error in every sense a test cares about. `contract.test.js`'s
 * BUILD-RAN-MARKER case is the one that proved it, by failing when this helper
 * asked the `instanceof` question first.
 *
 * `Error` is still the narrowed type, because `message` and `name` are the whole
 * of what callers read off a throw here — it names the shape being relied on,
 * not the constructor the value came from.
 *
 * @param {unknown} err
 * @returns {asserts err is Error}
 */
function threw (err) {
  const shape = /** @type {{ message?: unknown } | null | undefined} */ (err)
  assert.ok(typeof shape?.message === 'string', `threw something with no message: ${String(err)}`)
}

/** @type {[string, () => void][]} */
const cases = []
/** @param {string} name @param {() => void} fn */
const test = (name, fn) => cases.push([name, fn])

/** @param {any[]} raws */
const parseAll = (raws) => {
  /** @type {Record<string, any>} */
  const out = {}
  for (const r of raws) out[r.name] = manifest.parse(r)
  return out
}

/**
 * A manifest fixture, as it stands before `manifest.parse` sees it.
 *
 * `contracts`, `kinds` and `permissions` are `any[]`, and this is the one place
 * in this suite where that is the honest answer rather than a shrug. The cases
 * below reach *into* these lists and rewrite them — a port's `range`, a kind's
 * `provides`, a contract's `shape`, a `cardinality` — and several deliberately
 * write shapes that `manifest.parse` or `chain.validate` is supposed to refuse.
 * Restating the protocol's types here would mean keeping a second copy of them in
 * a test file, and it would reject the very fixtures the negative cases exist to
 * build. `manifest.parse` takes `unknown` and validates at runtime; that is where
 * the shape of these objects is checked, and it is checked for real.
 *
 * `over` used to be typed `object`, which typed nothing: a spread of `object`
 * contributes no members, so the result was `{ name, version, entry }` and every
 * `raws[i].kinds` below was an error about a property that does not exist.
 *
 * @typedef {object} Raw
 * @property {string} name
 * @property {string} version
 * @property {string} entry
 * @property {{ name: string, range: string }[]} [deps]
 * @property {any[]} [contracts]
 * @property {any[]} [kinds]
 * @property {any[]} [permissions]
 */

/**
 * One link of the chain: declares a contract, provides it, and needs the next.
 *
 * Generic in what is spread over the base, so a caller that passes `kinds` gets
 * back a fixture the checker knows has `kinds`. Returning a flat `Raw` would push
 * every list back to optional and force a `?.` at each of the two dozen places a
 * case reaches into one — and a `?.` there is worse than a type error, because it
 * turns "this fixture lost its kinds" into a mutation that silently did nothing.
 *
 * @template {Partial<Raw>} O
 * @param {string} name @param {O} over
 * @returns {Raw & O}
 */
const link = (name, over) => ({
  name,
  version: '1.0.0',
  entry: '/index.js',
  ...over
})

/**
 * `a` needs `b` needs `c` needs `d`, expressed the new way: each contract states
 * what its own providers must consume, so the chain is in the declarations and
 * not only in the wiring.
 *
 * The return says `contracts` and `kinds` are *present*, which `Raw` leaves open
 * because not every fixture in this file declares both. Every link here does, and
 * saying so is what lets the cases below write `raws[2].kinds[0].ports[0]`
 * without a chain of `?.` that would turn a fixture that stopped having kinds
 * into a case that silently mutated nothing and still passed.
 *
 * @returns {(Raw & { contracts: any[], kinds: any[] })[]}
 */
function four () {
  return [
    link('a', {
      deps: [{ name: 'b', range: '^1.0.0' }],
      contracts: [{ id: 'A', version: '1.0.0', requires: [{ contract: 'B', range: '^1.0.0' }] }],
      kinds: [{
        key: 'a',
        version: '1.0.0',
        provides: [{ id: 'A', version: '1.0.0' }],
        ports: [{ name: 'b', contract: 'B', range: '^1.0.0', cardinality: 'one' }]
      }]
    }),
    link('b', {
      deps: [{ name: 'c', range: '^1.0.0' }],
      contracts: [{ id: 'B', version: '1.0.0', requires: [{ contract: 'C', range: '^1.0.0' }] }],
      kinds: [{
        key: 'b',
        version: '1.0.0',
        provides: [{ id: 'B', version: '1.0.0' }],
        ports: [{ name: 'c', contract: 'C', range: '^1.0.0', cardinality: 'one' }]
      }]
    }),
    link('c', {
      deps: [{ name: 'd', range: '^1.0.0' }],
      contracts: [{ id: 'C', version: '1.0.0', requires: [{ contract: 'D', range: '^1.0.0' }] }],
      kinds: [{
        key: 'c',
        version: '1.0.0',
        provides: [{ id: 'C', version: '1.0.0' }],
        ports: [{ name: 'd', contract: 'D', range: '^1.0.0', cardinality: 'one' }]
      }]
    }),
    link('d', {
      contracts: [{ id: 'D', version: '1.0.0' }],
      kinds: [{ key: 'd', version: '1.0.0', provides: [{ id: 'D', version: '1.0.0' }], ports: [] }]
    })
  ]
}

/**
 * The wiring for `four()`, as `plan()` would have derived it.
 *
 * Typed as `InstanceSpec[]` rather than left to inference, because the four
 * `bindings` objects have different keys: inferred, the array's element type is a
 * union in which each member's *other* ports are present-but-`undefined`, and
 * `undefined` is not assignable to `InstanceSpec`'s
 * `Record<string, string | string[]>`. Naming the type the validator takes is
 * also the more useful statement — these are stand-ins for derived specs.
 *
 * @returns {import('../lib/chain').InstanceSpec[]}
 */
const wired = () => [
  { id: 'a', artifact: 'a', kind: 'a', bindings: { b: 'b' } },
  { id: 'b', artifact: 'b', kind: 'b', bindings: { c: 'c' } },
  { id: 'c', artifact: 'c', kind: 'c', bindings: { d: 'd' } },
  { id: 'd', artifact: 'd', kind: 'd', bindings: {} }
]

/** @param {chain.Verdict} v @param {string} code */
const of = (v, code) => v.problems.filter((p) => p.code === code)

/* ─────────────────── the negative: a good chain is clean ───────────────── */

test('a valid four-deep chain validates clean', () => {
  const v = chain.validate(parseAll(four()), wired())
  assert.equal(v.ok, true, JSON.stringify(v.problems, null, 2))
  assert.equal(v.problems.length, 0)
  assert.equal(v.cycles.length, 0)
  assert.equal(chain.explain(v), 'the chain is valid')
})

/* ──────────────── a failure at the far end, named all the way ──────────── */

test('a problem three hops out is reported, and names the path that led there', () => {
  const specs = wired()
  // `d` is gone from the graph entirely — the unsatisfiable end of the chain.
  const broken = specs.filter((s) => s.id !== 'd')
  const v = chain.validate(parseAll(four()), broken)

  assert.equal(v.ok, false)
  const unknown = of(v, 'UNKNOWN_TARGET')
  assert.equal(unknown.length, 1, JSON.stringify(v.problems))
  assert.equal(unknown[0].instance, 'c')
  assert.equal(unknown[0].path.join('>'), 'a>b>c')
  assert.ok(unknown[0].message.includes('reached by a -> b -> c'), unknown[0].message)
})

test('an unsatisfiable requirement at the far end is reported at the far end, with the path', () => {
  const manifests = parseAll(four())
  // `c` exists and provides C, but its D port is bound to nothing — so the
  // requirement C@1.0.0 places on its own providers is unmet, three hops from
  // where an admin is looking.
  const specs = wired().map((s) => (s.id === 'c' ? { ...s, bindings: {} } : s))
  const v = chain.validate(manifests, specs)

  assert.equal(v.ok, false)
  const unmet = of(v, 'REQUIREMENT_UNBOUND')
  assert.equal(unmet.length, 1, JSON.stringify(v.problems))
  assert.equal(unmet[0].instance, 'c')
  assert.equal(unmet[0].path.join('>'), 'a>b>c')
  assert.ok(unmet[0].message.includes('C@1.0.0'), unmet[0].message)
  assert.ok(unmet[0].message.includes('D ^1.0.0'), unmet[0].message)
  assert.ok(unmet[0].message.includes('a -> b -> c'), unmet[0].message)
})

test('a requirement bound to something that does not provide it is caught', () => {
  const manifests = parseAll(four())
  // `c`'s D port points at `a`, which is in the graph and provides A, not D.
  const specs = wired().map((s) => (s.id === 'c' ? { ...s, bindings: { d: 'a' } } : s))
  const v = chain.validate(manifests, specs)

  assert.equal(of(v, 'REQUIREMENT_VERSION').length, 1, JSON.stringify(v.problems))
  assert.equal(of(v, 'NOT_A_PROVIDER').length, 1)
  assert.equal(of(v, 'NOT_A_PROVIDER')[0].instance, 'c')
})

test('a requirement met at a version outside its range is not met', () => {
  const raws = four()
  // `d` moves to D@2.0.0 and `c`'s port widens to accept it, but C's own
  // requirement still says ^1.0.0. The wiring is fine and the chain is not.
  raws[3].contracts = [{ id: 'D', version: '2.0.0' }]
  raws[3].kinds = [{ key: 'd', version: '1.0.0', provides: [{ id: 'D', version: '2.0.0' }], ports: [] }]
  raws[2].kinds[0].ports[0].range = '^1.0.0 || ^2.0.0'
  const v = chain.validate(parseAll(raws), wired())

  const bad = of(v, 'REQUIREMENT_VERSION')
  assert.equal(bad.length, 1, JSON.stringify(v.problems))
  assert.ok(bad[0].message.includes('D ^1.0.0'), bad[0].message)
})

/**
 * A contract declared in one artifact and provided by another, where the
 * declaration demands something of its providers.
 *
 * This arrangement is the *only* way `UNMET_REQUIREMENT` is reachable, and that
 * is worth stating because it is easy to write a fixture that cannot reach it.
 * `manifest.parse` refuses the local half outright — a manifest that declares
 * `X requires Y` and has a kind providing `X` with no `Y` port does not parse,
 * and the case below asserts that it still does not. So the port-missing fault
 * only survives to this module when the declaration lives in a **dep**, which is
 * precisely the arrangement `manifest.parse` cannot see and this module exists
 * for.
 *
 * @param {any[]} [ports] what the provider's kind declares, `[]` being the fault
 */
const remote = (ports = []) => parseAll([
  link('decl', {
    contracts: [
      { id: 'X', version: '1.0.0', requires: [{ contract: 'Y', range: '^1.0.0' }] },
      { id: 'Y', version: '1.0.0' }
    ],
    kinds: []
  }),
  link('why', {
    deps: [{ name: 'decl', range: '^1.0.0' }],
    kinds: [{ key: 'y', version: '1.0.0', provides: [{ id: 'Y', version: '1.0.0' }], ports: [] }]
  }),
  link('prov', {
    deps: [{ name: 'decl', range: '^1.0.0' }],
    kinds: [{ key: 'p', version: '1.0.0', provides: [{ id: 'X', version: '1.0.0' }], ports }]
  })
])

/** @param {Record<string, string | string[]>} bindings @returns {import('../lib/chain').InstanceSpec[]} */
const remoteSpecs = (bindings) => [
  { id: 'p', artifact: 'prov', kind: 'p', bindings },
  { id: 'why', artifact: 'why', kind: 'y', bindings: {} }
]

test('a provider with no port at all for what its contract requires is named', () => {
  // `UNMET_REQUIREMENT` had no test reference at all, in the newest machinery in
  // this file. What would break this: deleting the `ports.length === 0` branch in
  // `requirementProblems`, which would fall through to `bound.length === 0` and
  // report `REQUIREMENT_UNBOUND` against `ports[0].name` — reading `.name` off
  // `undefined` and taking out the whole verdict.
  const v = chain.validate(remote([]), remoteSpecs({}))
  const bad = of(v, 'UNMET_REQUIREMENT')
  assert.equal(bad.length, 1, chain.explain(v))
  assert.equal(bad[0].instance, 'p')
  assert.equal(bad[0].port, '', 'the fault is about a missing port, so it names none')
  assert.ok(bad[0].message.includes('X@1.0.0'), bad[0].message)
  assert.ok(bad[0].message.includes('Y ^1.0.0'), bad[0].message)
  assert.ok(bad[0].message.includes('declares no port for Y'), bad[0].message)
  // And it is this code and not the neighbouring one, which is the half a test
  // asserting only `v.ok === false` would miss.
  assert.equal(of(v, 'REQUIREMENT_UNBOUND').length, 0, chain.explain(v))
})

test('the same fault inside one manifest never reaches here, because the parser has it', () => {
  // The other half of the case above: `UNMET_REQUIREMENT` is not this module
  // duplicating `manifest.parse`, it is the reach `manifest.parse` does not have.
  // If the parser ever stopped refusing the local form, this fails and the case
  // above becomes the only checker — which is a change somebody should make on
  // purpose rather than discover.
  try {
    manifest.parse(link('solo', {
      contracts: [{ id: 'X', version: '1.0.0', requires: [{ contract: 'Y', range: '^1.0.0' }] }],
      kinds: [{ key: 'p', version: '1.0.0', provides: [{ id: 'X', version: '1.0.0' }], ports: [] }]
    }))
    assert.fail('manifest.parse accepted a kind providing a contract it cannot consume')
  } catch (err) {
    threw(err)
    assert.ok(err.message.includes('declares no port for Y'), err.message)
  }
})

test('a port that exists but is bound to nothing is unbound, not unmet', () => {
  // The "fires when it should not" direction. `UNMET_REQUIREMENT` is about the
  // *kind's declaration*, and an empty binding is a different fault with a
  // different fix — the first is edited in a manifest, the second in a plan.
  // Collapsing them would send an admin to the wrong file.
  const ports = [{ name: 'y', contract: 'Y', range: '^1.0.0', cardinality: 'optional' }]
  const v = chain.validate(remote(ports), remoteSpecs({}))
  assert.equal(of(v, 'UNMET_REQUIREMENT').length, 0, chain.explain(v))
  const bad = of(v, 'REQUIREMENT_UNBOUND')
  assert.equal(bad.length, 1, chain.explain(v))
  assert.equal(bad[0].port, 'y', 'a port-scoped problem carries its port')
})

test('a port that exists and is bound to a real provider is clean', () => {
  // The negative that keeps the two cases above honest: a checker that reported
  // `UNMET_REQUIREMENT` for every remote declaration would pass both of them.
  const ports = [{ name: 'y', contract: 'Y', range: '^1.0.0', cardinality: 'one' }]
  const v = chain.validate(remote(ports), remoteSpecs({ y: 'why' }))
  assert.equal(v.ok, true, chain.explain(v))
})

/* ─────────────────────── every problem, not the first ──────────────────── */

test('every problem in a thoroughly broken graph is reported', () => {
  const manifests = parseAll(four())
  /** @type {import('../lib/chain').InstanceSpec[]} */
  const specs = [
    // unknown target, and its own requirement therefore unmet
    { id: 'a', artifact: 'a', kind: 'a', bindings: { b: 'nowhere' } },
    // bound to a list on a `one` port
    { id: 'b', artifact: 'b', kind: 'b', bindings: { c: ['c'] } },
    // bound to something that does not provide C
    { id: 'c', artifact: 'c', kind: 'c', bindings: { d: 'b' } },
    { id: 'd', artifact: 'd', kind: 'd', bindings: {} },
    // an artifact nobody has a manifest for
    { id: 'ghost', artifact: 'ghost', kind: 'ghost', bindings: {} },
    // a kind that artifact does not have
    { id: 'wrong', artifact: 'd', kind: 'nope', bindings: {} }
  ]
  const v = chain.validate(manifests, specs)

  // Named individually rather than by count alone, so this cannot pass by
  // reporting six copies of one thing.
  const codes = new Set(v.problems.map((p) => p.code))
  for (const code of ['UNKNOWN_TARGET', 'WRONG_ARITY', 'NOT_A_PROVIDER', 'UNKNOWN_ARTIFACT', 'UNKNOWN_KIND']) {
    assert.ok(codes.has(code), `expected a ${code}, got ${[...codes].join(', ')}`)
  }
  assert.ok(v.problems.length >= 6, `expected at least six problems, got ${v.problems.length}`)
})

test('problems come back in one order however the specs arrive', () => {
  const manifests = parseAll(four())
  const specs = wired().filter((s) => s.id !== 'd')
  const forwards = chain.validate(manifests, specs)
  const backwards = chain.validate(manifests, [...specs].reverse())
  assert.equal(JSON.stringify(forwards), JSON.stringify(backwards))
})

/* ────────────────────────────── cardinality ────────────────────────────── */

test('an unsatisfiable one is an error and an unsatisfiable optional is not', () => {
  const raws = four()
  const required = chain.validate(parseAll(raws), [
    { id: 'a', artifact: 'a', kind: 'a', bindings: {} }
  ])
  assert.equal(of(required, 'UNBOUND_REQUIRED').length, 1)

  raws[0].kinds[0].ports[0].cardinality = 'optional'
  // The requirement rule still fires — a contract's author saying "a provider
  // without this cannot do the job" outranks a consuming kind calling the port
  // optional — but the *cardinality* rule does not.
  const loose = chain.validate(parseAll(raws), [
    { id: 'a', artifact: 'a', kind: 'a', bindings: {} }
  ])
  assert.equal(of(loose, 'UNBOUND_REQUIRED').length, 0)
  assert.equal(of(loose, 'REQUIREMENT_UNBOUND').length, 1)
})

test('a many port bound to nothing is a consumer with nothing in it, not a fault', () => {
  const raws = four()
  raws[0].kinds[0].ports[0].cardinality = 'many'
  raws[0].contracts = [{ id: 'A', version: '1.0.0' }] // drop the requirement
  const v = chain.validate(parseAll(raws), [{ id: 'a', artifact: 'a', kind: 'a', bindings: { b: [] } }])
  assert.equal(v.ok, true, chain.explain(v))
})

test('a list on a one port and a scalar on a many port are both wrong arity', () => {
  const raws = four()
  raws[0].contracts = [{ id: 'A', version: '1.0.0' }]
  const one = chain.validate(parseAll(raws), [
    { id: 'a', artifact: 'a', kind: 'a', bindings: { b: ['b'] } },
    { id: 'b', artifact: 'b', kind: 'b', bindings: { c: 'c' } },
    { id: 'c', artifact: 'c', kind: 'c', bindings: { d: 'd' } },
    { id: 'd', artifact: 'd', kind: 'd', bindings: {} }
  ])
  assert.equal(of(one, 'WRONG_ARITY').length, 1)

  raws[0].kinds[0].ports[0].cardinality = 'many'
  const many = chain.validate(parseAll(raws), [
    { id: 'a', artifact: 'a', kind: 'a', bindings: { b: 'b' } },
    { id: 'b', artifact: 'b', kind: 'b', bindings: { c: 'c' } },
    { id: 'c', artifact: 'c', kind: 'c', bindings: { d: 'd' } },
    { id: 'd', artifact: 'd', kind: 'd', bindings: {} }
  ])
  assert.equal(of(many, 'WRONG_ARITY').length, 1)
})

/* ─────────────────────── shapes, along every hop ───────────────────────── */

test('an incompatible shape on a hop is caught even though every link exists', () => {
  const raws = four()
  // `a` sees two versions of B through its dep on `b`, and its port admits both.
  // B@1.1.0 drops an operation B@1.0.0 promised, so a provider of 1.1.0 cannot
  // stand where the port's own baseline says it must.
  raws[1].contracts = [
    {
      id: 'B',
      version: '1.0.0',
      requires: [{ contract: 'C', range: '^1.0.0' }],
      shape: { operations: [{ name: 'reach' }, { name: 'settle' }] }
    },
    {
      id: 'B',
      version: '1.1.0',
      requires: [{ contract: 'C', range: '^1.0.0' }],
      shape: { operations: [{ name: 'reach' }] }
    }
  ]
  raws[1].kinds[0].provides = [{ id: 'B', version: '1.1.0' }]
  const v = chain.validate(parseAll(raws), wired())

  const bad = of(v, 'INCOMPATIBLE_SHAPE')
  assert.equal(bad.length, 1, JSON.stringify(v.problems))
  assert.equal(bad[0].instance, 'a')
  assert.equal(bad[0].port, 'b')
  assert.ok(bad[0].message.includes('B@1.0.0'), bad[0].message)
  assert.ok(bad[0].message.includes('settle was removed'), bad[0].message)
})

test('the shape rule runs on an explicit binding, which plan.js leaves alone', () => {
  // `plan.js` only checks what it derives; an admin naming a target by hand is
  // deciding which instance, not waiving what a range means. This is the
  // guarantee the static verdict adds over the derived one.
  const raws = four()
  raws[1].contracts = [
    { id: 'B', version: '1.0.0', requires: [{ contract: 'C', range: '^1.0.0' }], shape: { operations: [{ name: 'reach' }] } },
    { id: 'B', version: '1.1.0', requires: [{ contract: 'C', range: '^1.0.0' }], shape: { operations: [{ name: 'reach', params: [{ name: 'x', type: 'string' }] }] } }
  ]
  raws[1].kinds[0].provides = [{ id: 'B', version: '1.1.0' }]
  const manifests = parseAll(raws)
  // A required parameter appearing is narrowing, so this must be caught.
  const v = chain.validate(manifests, wired())
  assert.equal(of(v, 'INCOMPATIBLE_SHAPE').length, 1, chain.explain(v))
})

test('a provider outside the port range, and one that provides something else, are told apart', () => {
  const raws = four()
  raws[0].kinds[0].ports[0].range = '^2.0.0'
  raws[0].contracts = [{ id: 'A', version: '1.0.0' }]
  const v = chain.validate(parseAll(raws), wired())
  assert.equal(of(v, 'VERSION_OUT_OF_RANGE').length, 1)
  assert.equal(of(v, 'NOT_A_PROVIDER').length, 0)
})

/* ────────────── a family declared one manifest further out ─────────────── */

/** `renderer@2` in miniature, declared in one artifact and provided by two others. */
const families = () => {
  const RENDERER = {
    family: { selector: 'family', returns: ['render'] },
    operations: [
      { name: 'family', returns: { type: 'string' } },
      { name: 'render' }
    ]
  }
  /** `family` absent is the case under test — a provider that never said which
   *  one it is — so it is optional rather than nullable.
   *  @param {string} name @param {{ tag: string, returns: Record<string, unknown> }} [family] */
  const provider = (name, family) => link(name, {
    deps: [{ name: 'decl', range: '^1.0.0' }],
    kinds: [{
      key: 'r',
      version: '1.0.0',
      provides: family === undefined
        ? [{ id: 'renderer', version: '2.0.0' }]
        : [{ id: 'renderer', version: '2.0.0', family }],
      ports: []
    }]
  })
  return { RENDERER, provider }
}

const TEXT = { tag: 'text@1', returns: { render: { type: 'string' } } }

/** @param {any[]} providers */
const familySet = (providers) => {
  const { RENDERER } = families()
  return parseAll([
    link('decl', { contracts: [{ id: 'renderer', version: '2.0.0', shape: RENDERER }], kinds: [] }),
    ...providers
  ])
}

/** @param {string[]} names @returns {import('../lib/chain').InstanceSpec[]} */
const familySpecs = (names) => names.map((n) => ({ id: n, artifact: n, kind: 'r', bindings: {} }))

test('a provider that never says which family it is, is caught across manifests', () => {
  // `manifest.parse` cannot see this: the declaration is in a dep, so the only
  // place both documents are in hand is here.
  const { provider } = families()
  const v = chain.validate(familySet([provider('text', undefined)]), familySpecs(['text']))
  assert.equal(of(v, 'MISSING_FAMILY').length, 1, chain.explain(v))
  assert.ok(of(v, 'MISSING_FAMILY')[0].message.includes('render'), of(v, 'MISSING_FAMILY')[0].message)
})

test('a provider typing the wrong set of operations is caught across manifests', () => {
  const { provider } = families()
  const v = chain.validate(
    familySet([provider('text', { tag: 'text@1', returns: { family: { type: 'string' } } })]),
    familySpecs(['text'])
  )
  assert.equal(of(v, 'FAMILY_MISMATCH').length, 1, chain.explain(v))
})

test('two providers wearing one tag and answering differently is caught', () => {
  // The price of leaving families open, paid where it can be: nothing local can
  // see two manifests disagreeing about what `text@1` means.
  const { provider } = families()
  const v = chain.validate(
    familySet([
      provider('text', TEXT),
      provider('other', { tag: 'text@1', returns: { render: { type: 'object' } } })
    ]),
    familySpecs(['text', 'other'])
  )
  assert.equal(of(v, 'FAMILY_DISAGREEMENT').length, 1, chain.explain(v))
  assert.ok(of(v, 'FAMILY_DISAGREEMENT')[0].message.includes('text@1'))
})

/**
 * The same two artifacts as `familySet`, but the declaration's shape leaves
 * *nothing* to a family — no `family` key on it at all.
 *
 * `families()`'s `RENDERER` has one, which is what every case above is for. This
 * is the mirror, and it needs its own declarer because the whole difference is
 * one field on the declaration rather than anything the provider does.
 *
 * @param {boolean} shaped whether the declaration carries a shape at all
 * @param {any[]} providers
 */
const plainSet = (shaped, providers) => parseAll([
  link('decl', {
    contracts: [shaped
      ? { id: 'renderer', version: '2.0.0', shape: { operations: [{ name: 'render' }] } }
      : { id: 'renderer', version: '2.0.0' }],
    kinds: []
  }),
  ...providers
])

test('a provider declaring a family for a contract that asked for none is caught', () => {
  // `UNWANTED_FAMILY` had no test reference, and the branch it guards is three
  // conditions deep — `wants === undefined && says !== undefined && shape
  // !== undefined`. What would break this: dropping the `says !== undefined`
  // half, which turns every plain provider of a plain contract into a fault.
  const { provider } = families()
  const v = chain.validate(plainSet(true, [provider('text', TEXT)]), familySpecs(['text']))
  const bad = of(v, 'UNWANTED_FAMILY')
  assert.equal(bad.length, 1, chain.explain(v))
  assert.equal(bad[0].instance, 'text')
  assert.equal(bad[0].port, '', 'a provider-side fault is not about a port')
  assert.ok(bad[0].message.includes('renderer@2.0.0'), bad[0].message)
  assert.ok(bad[0].message.includes('nothing for a family to decide'), bad[0].message)
  // Not the neighbouring codes. A family the declaration never asked for is a
  // provider claiming more than it was asked, which is not a mismatch of sets.
  assert.equal(of(v, 'MISSING_FAMILY').length, 0, chain.explain(v))
  assert.equal(of(v, 'FAMILY_MISMATCH').length, 0, chain.explain(v))
})

test('a declaration carrying no shape at all says nothing either way', () => {
  // The `decl?.shape !== undefined` half, which is the one most likely to be
  // dropped as redundant — `wants` is already `undefined` in both cases. It is
  // not redundant: an unverifiable shape is `assemble.js`'s report to make, and
  // reporting it here would fault every provider of a contract whose declarer is
  // simply not in this artifact set.
  const { provider } = families()
  const v = chain.validate(plainSet(false, [provider('text', TEXT)]), familySpecs(['text']))
  assert.equal(of(v, 'UNWANTED_FAMILY').length, 0, chain.explain(v))
  assert.equal(v.ok, true, chain.explain(v))
})

test('a plain provider of a plain declaration is clean', () => {
  // The negative. A checker that fired `UNWANTED_FAMILY` on shape-without-family
  // regardless of what the provider said would pass the first case and fail here.
  const { provider } = families()
  const v = chain.validate(plainSet(true, [provider('text', undefined)]), familySpecs(['text']))
  assert.equal(v.ok, true, chain.explain(v))
})

/**
 * A kind providing `kernel:surface-adapter@<version>` for one surface and one OS.
 *
 * No declaration anywhere and no dep to reach one, which is the arrangement the
 * `kernel:` namespace exists to make expressible: the contract's consumer is the
 * kernel, the kernel is not a dependency, and nothing may declare it. The comment
 * that stood here said the declaration lived in a dep "as it does in the tree —
 * `artifact-cli` owns the contract", and that was never true: all three adapters
 * declared their own identical copy, and `artifact-cli` declared none of it. The
 * fixture is now the arrangement the tree actually has.
 *
 * Nothing about this weakens the case below. A pair of claimants is still
 * something no single manifest can see, and a whole-graph pass is still the only
 * place it can be seen — that was never a consequence of where the declaration
 * sat.
 */
const adapter = (/** @type {string} */ name, /** @type {object} */ entry, /** @type {string} */ version = '1.0.0') =>
  link(name, {
    kinds: [{
      key: 'a',
      version: '1.0.0',
      provides: [{ id: 'kernel:surface-adapter', version, ...entry }],
      ports: []
    }]
  })

const surfaceSet = (/** @type {any[]} */ providers) => parseAll(providers)

const adapterSpecs = (/** @type {string[]} */ names) => names.map((n) => ({ id: n, artifact: n, kind: 'a', bindings: {} }))

test('two instances claiming one surface and platform is a verdict, not a boot-time throw', () => {
  // `boot.js` refuses this pair by name and still does. What it could not do is
  // tell an admin *before* they signed the network state that put both adapters
  // in it, which is the whole reason this module exists.
  const set = surfaceSet([
    adapter('mac', { surface: 'cli', platform: 'darwin' }),
    adapter('mac-too', { surface: 'cli', platform: 'darwin' })
  ])
  const v = chain.validate(set, adapterSpecs(['mac', 'mac-too']))

  // One per claimant: neither is the odd one out, and which came first is the
  // fact that must not decide anything.
  const dup = of(v, 'DUPLICATE_SURFACE')
  assert.equal(dup.length, 2, chain.explain(v))
  assert.ok(dup[0].message.includes('mac declares the cli surface on darwin for kernel:surface-adapter@1'), dup[0].message)
  assert.ok(dup[0].message.includes('and so does mac-too'), dup[0].message)
  assert.ok(dup[1].message.includes('and so does mac'), dup[1].message)
  assert.equal(v.ok, false)
})

test('and the pair is the fault, not the declaring', () => {
  // The negative, asserted as hard as the positive. One adapter per platform is
  // exactly what the fields are for, and a checker that says no to every
  // manifest carrying them would catch this bug and be worthless.
  const two = chain.validate(surfaceSet([
    adapter('mac', { surface: 'cli', platform: 'darwin' }),
    adapter('win', { surface: 'cli', platform: 'win32' })
  ]), adapterSpecs(['mac', 'win']))
  assert.equal(of(two, 'DUPLICATE_SURFACE').length, 0, chain.explain(two))

  // Two surfaces on one OS is the arrangement `window` was admitted for.
  const both = chain.validate(surfaceSet([
    adapter('mac', { surface: 'cli', platform: 'darwin' }),
    adapter('pane', { surface: 'window', platform: 'darwin' })
  ]), adapterSpecs(['mac', 'pane']))
  assert.equal(of(both, 'DUPLICATE_SURFACE').length, 0, chain.explain(both))

  // And a provider saying nothing about what it adapts claims no pair. Absent is
  // legal in the protocol and stays legal here; `boot.js` is where declaring the
  // contract and not the fields is refused, because that is a question about the
  // kernel's own contract and not about two documents agreeing.
  const quiet = chain.validate(surfaceSet([
    adapter('mac', {}),
    adapter('mac-too', {})
  ]), adapterSpecs(['mac', 'mac-too']))
  assert.equal(of(quiet, 'DUPLICATE_SURFACE').length, 0, chain.explain(quiet))
})

test('the pair is judged per major, which is how a consumer resolves it', () => {
  // A caret range is what `boot.js` asks with, so `@1.0.0` beside `@1.2.0` is one
  // question with two answers and is reported...
  const within = chain.validate(surfaceSet([
    adapter('mac', { surface: 'cli', platform: 'darwin' }, '1.0.0'),
    adapter('mac-too', { surface: 'cli', platform: 'darwin' }, '1.2.0')
  ]), adapterSpecs(['mac', 'mac-too']))
  assert.equal(of(within, 'DUPLICATE_SURFACE').length, 2, chain.explain(within))

  // ...while `@1` beside `@2` is two questions, and no single caret range
  // resolves to both. The honest limit is in `surfaceClaims`: a consumer pinning
  // wider than one major would see an ambiguity this does not name, and there is
  // no such consumer.
  const across = chain.validate(surfaceSet([
    adapter('mac', { surface: 'cli', platform: 'darwin' }, '1.0.0'),
    adapter('next', { surface: 'cli', platform: 'darwin' }, '2.0.0')
  ]), adapterSpecs(['mac', 'next']))
  assert.equal(of(across, 'DUPLICATE_SURFACE').length, 0, chain.explain(across))
})

test('two providers in two different families are exactly what this is for', () => {
  const { provider } = families()
  const v = chain.validate(
    familySet([
      provider('text', TEXT),
      provider('doc', { tag: 'document@1', returns: { render: { type: 'object' } } })
    ]),
    familySpecs(['text', 'doc'])
  )
  assert.equal(v.ok, true, chain.explain(v))
})

test('two providers agreeing under one tag is not a disagreement', () => {
  const { provider } = families()
  const v = chain.validate(
    familySet([provider('text', TEXT), provider('other', { tag: 'text@1', returns: { render: { type: 'string' } } })]),
    familySpecs(['text', 'other'])
  )
  assert.equal(v.ok, true, chain.explain(v))
})

/* ─────────────── a port that says which family it wants ─────────────────── */

/**
 * A consumer of the miniature `renderer@2` above, whose port names a family.
 *
 * @param {string} [family]
 * @param {'one' | 'optional'} [cardinality]
 */
const wants = (family, cardinality = 'one') => link('viewer', {
  deps: [{ name: 'decl', range: '^1.0.0' }],
  kinds: [{
    key: 'v',
    version: '1.0.0',
    provides: [],
    ports: [{
      name: 'r',
      contract: 'renderer',
      range: '^2.0.0',
      cardinality,
      ...(family === undefined ? {} : { family })
    }]
  }]
})

/** @param {string|null} bound @param {any[]} extra */
const viewerSpecs = (bound, extra) => [
  { id: 'viewer', artifact: 'viewer', kind: 'v', bindings: bound === null ? {} : { r: bound } },
  ...extra
]

test('a port asking for a family nobody in the graph provides is a chain problem', () => {
  // The static half of the resolver's filter, and the reason it is worth having
  // separately: `plan.js` throws this on somebody's device, and `network check`
  // says it to the admin before anything is signed.
  const { provider } = families()
  const v = chain.validate(
    familySet([provider('text', TEXT), wants('widget@1')]),
    viewerSpecs('text', familySpecs(['text']))
  )
  const bad = of(v, 'NO_SUCH_FAMILY')
  assert.equal(bad.length, 1, chain.explain(v))
  assert.equal(bad[0].port, 'r', 'a port-scoped problem carries its port')
  assert.ok(bad[0].message.includes('widget@1'), bad[0].message)
  assert.ok(bad[0].message.includes('text@1'), 'and says what is on offer instead')
  assert.ok(bad[0].message.includes('text'), bad[0].message)
})

test('the missing family is reported with the path that reaches the port', () => {
  // Every problem here carries the shortest path from a root, because the
  // instance an admin has to look at and the instance that is broken are usually
  // not the same one. A viewer reached through another instance says so.
  const { provider } = families()
  const shell = link('shell', {
    deps: [{ name: 'decl', range: '^1.0.0' }],
    contracts: [],
    kinds: [{
      key: 's',
      version: '1.0.0',
      provides: [],
      ports: [{ name: 'inner', contract: 'renderer', range: '^2.0.0', cardinality: 'optional' }]
    }]
  })
  const set = familySet([provider('text', TEXT), wants('widget@1'), shell])
  const v = chain.validate(set, [
    { id: 'shell', artifact: 'shell', kind: 's', bindings: { inner: 'viewer' } },
    ...viewerSpecs('text', familySpecs(['text']))
  ])
  const bad = of(v, 'NO_SUCH_FAMILY')
  assert.equal(bad.length, 1, chain.explain(v))
  assert.equal(bad[0].path.join(' -> '), 'shell -> viewer', JSON.stringify(bad[0].path))
  assert.ok(bad[0].message.includes('(reached by shell -> viewer)'), bad[0].message)
})

test('an optional port asking for an absent family is caught, which nothing else could see', () => {
  // The case that makes this a graph question rather than a binding question.
  // An unbound `optional` port is the absence the whole design is built on, so
  // every other check here is right to say nothing about it — and a port whose
  // family the network simply does not have is broken in a way that absence
  // hides perfectly.
  const { provider } = families()
  const v = chain.validate(
    familySet([provider('text', TEXT), wants('widget@1', 'optional')]),
    viewerSpecs(null, familySpecs(['text']))
  )
  assert.equal(of(v, 'NO_SUCH_FAMILY').length, 1, chain.explain(v))
  assert.equal(of(v, 'UNBOUND_REQUIRED').length, 0, 'an optional port is not unbound-required')
})

test('a port bound across families is refused, because an admin names a target and not a waiver', () => {
  // `plan.js` cannot produce this — its filter ran before it chose — so
  // everything here arrives by the one route derivation does not touch: a signed
  // binding. Naming a target is deciding which instance, not waiving what the
  // port asked for, which is the same argument the substitution check makes.
  const { provider } = families()
  const v = chain.validate(
    familySet([
      provider('text', TEXT),
      provider('doc', { tag: 'document@1', returns: { render: { type: 'object' } } }),
      wants('text@1')
    ]),
    viewerSpecs('doc', familySpecs(['text', 'doc']))
  )
  const bad = of(v, 'WRONG_FAMILY')
  assert.equal(bad.length, 1, chain.explain(v))
  assert.equal(bad[0].port, 'r')
  assert.ok(bad[0].message.includes('text@1'), bad[0].message)
  assert.ok(bad[0].message.includes('document@1'), bad[0].message)
  assert.ok(bad[0].message.includes('bound to doc'), bad[0].message)
})

test('a port bound inside the family it asked for is clean, both families present', () => {
  const { provider } = families()
  const v = chain.validate(
    familySet([
      provider('text', TEXT),
      provider('doc', { tag: 'document@1', returns: { render: { type: 'object' } } }),
      wants('text@1')
    ]),
    viewerSpecs('text', familySpecs(['text', 'doc']))
  )
  assert.equal(v.ok, true, chain.explain(v))
})

test('a port that names no family is not narrowed by this module either', () => {
  // The parity assertion. If `visible`-style seeding or the supply index ever
  // started treating "did not ask" as "asked for nothing", every manifest
  // written before the field would fail here first.
  const { provider } = families()
  const v = chain.validate(
    familySet([provider('text', TEXT), wants(undefined)]),
    viewerSpecs('text', familySpecs(['text']))
  )
  assert.equal(v.ok, true, chain.explain(v))
})

/* ────────── the declarations the platform owns, visible to everyone ─────── */

test('the shape of the contract the kernel calls is visible without any manifest', () => {
  // `visible()` used to read `source.contracts` and nothing else, which made it
  // *structurally* incapable of resolving a `kernel:*` id: `manifest.parse`
  // refuses a manifest that declares one, so the single place it looked was
  // guaranteed empty for a whole namespace. Three rules quietly did not apply —
  // requirements, families, and shape substitution — and none of them said so.
  const set = surfaceSet([adapter('mac', { surface: 'cli', platform: 'darwin' })])
  const declared = chain.visible(set)

  const mine = declared.get('mac')
  assert.ok(mine !== undefined, 'the adapter is not in the visibility map at all')
  const decls = mine.get('kernel:surface-adapter')
  assert.ok(decls !== undefined && decls.length > 0, 'a kernel contract still resolves to nothing')
  assert.equal(decls[0].version, '1.0.0')
  const ops = (decls[0].shape?.operations ?? []).map((/** @type {any} */ o) => o.name).sort()
  assert.equal(ops.join(','), 'attach,commands,completions,detach,kind,platform,run')
})

test('every artifact sees it, because no artifact could have been carrying it', () => {
  // Seeded per artifact rather than resolved through deps, and that is not a
  // shortcut. A `kernel:` declaration is nobody's to hold, so there is no dep
  // edge that could ever lead to one — an artifact that reaches this contract
  // reaches it because the platform does, and that is true of all of them.
  const set = familySet([families().provider('text', TEXT)])
  for (const name of Object.keys(set)) {
    const seen = chain.visible(set).get(name)
    assert.ok(seen?.has('kernel:surface-adapter'), `${name} cannot see the platform's declaration`)
  }
})

test('a valid adapter graph is still clean once the declaration resolves', () => {
  // The regression guard on the seeding itself. Making a declaration visible
  // switches on `requirementProblems`, `familyProblems` and `substitution` for
  // this contract — all three of which previously fell through — so the
  // shipped arrangement has to still pass all of them.
  const v = chain.validate(
    surfaceSet([
      adapter('mac', { surface: 'cli', platform: 'darwin' }),
      adapter('win', { surface: 'cli', platform: 'win32' })
    ]),
    adapterSpecs(['mac', 'win'])
  )
  assert.equal(v.ok, true, chain.explain(v))
})

test('the platform namespace is deliberately not seeded, and the parser is why', () => {
  // The obvious reading of the three cases above is that `visible()` has a second
  // hole exactly like the one they close: there are seven `platform:*` contracts and
  // `visible()` seeds none of them, which is the same sentence that described the
  // `kernel:` bug. It is not the same bug, and the difference is worth pinning
  // rather than re-fixing.
  //
  // ## The list this walks is `NATIVE`, and it used to be
  // ## `capability.PLATFORM_CONTRACTS`
  //
  // That was not a wording problem, it was this case quietly emptying. ROADMAP §6a is
  // moving each `platform:*` declaration into its own repository, so
  // `artifact-protocol`'s table shrinks by one per sub-wave and is on its way to zero —
  // and a `for` over an empty array asserts nothing while looking maintained. §6a
  // named this file as the one place that happens and gave two ways out: make the
  // composed set reachable from here, or assert what this repo can actually know.
  //
  // The first is unavailable and its unavailability is the point.
  // `ArtifactPatform/lib/capabilities.js` is the only thing that sees all six, it is
  // the kernel's, and this module sits underneath the kernel — reaching up for it
  // would be the inversion the split exists to remove.
  //
  // So it is the second, and `NATIVE` is the better list on its own merits rather than
  // as a consolation. It is *this repo's own table*, it is what decides which contracts
  // a graph may name at all, every row it has is permanent, and it cannot empty
  // without this module changing — which is exactly the property
  // `capability.PLATFORM_CONTRACTS` lost. The claim is unchanged: whatever `NATIVE`
  // names is not seeded into `declared`.
  //
  // It said "all six rows permanently" and now has seven, which is the reason this
  // sentence no longer names a number. ROADMAP §6b's `platform:diagnostics` is the
  // first row added rather than moved, so the table's size is not a property of a
  // finished phase — and a count written into a comment beside a loop that derives
  // its own is exactly the drift `--check-ledger` exists for one document over.
  //
  // `declared` is read in exactly three places, and every one of them keys on an
  // id that `manifest.parse` refuses to let be `platform:` —
  // `requirementProblems` and `familyProblems` look up `kind.provides[].id`, and
  // `substitution` is only reached for a port `portProblems` did not already
  // `continue` past on the `platform:` prefix. So a seeded platform declaration
  // would be unreachable by construction, and seeding it would be dead weight
  // that reads like a rule.
  //
  // That makes the absence load-bearing on three refusals in another package.
  // This case is the tripwire: relax any of them and a `platform:` id starts
  // reaching a lookup that resolves to nothing, which is precisely the silent
  // no-op the `kernel:` fix was about — so it fails here, next to the argument,
  // rather than as three checks quietly not applying.
  const set = { solo: manifest.parse(link('solo', { contracts: [], kinds: [] })) }
  const seen = chain.visible(set).get('solo')
  assert.ok(seen !== undefined, 'the artifact is not in the visibility map at all')
  assert.ok(seen.has('kernel:surface-adapter'), 'the kernel declaration is no longer seeded')

  const platform = Object.keys(chain.NATIVE)
  // Non-vacuity, stated rather than assumed, because a loop over an empty list is
  // precisely what this case was rewritten to stop being. The exact count is what
  // `ArtifactPatform/test/chain.test.js` holds `NATIVE` to against the composed
  // capability table; here it only has to be more than none, which is the half this
  // repo can answer without reaching up into the kernel for the other two lists.
  assert.ok(platform.length > 0, 'NATIVE names no platform contracts, so the loop below proves nothing')
  for (const id of platform) {
    assert.ok(capability.isPlatformContract(id), `NATIVE names ${id}, which is not a platform contract`)
    assert.equal(seen.has(id), false, `${id} is seeded but nothing can read it — see this case`)
  }

  // The three refusals the paragraph above depends on. Written as data so a
  // seventh reader of `declared` cannot be added without a fourth line here
  // looking conspicuously absent.
  const refused = [
    ['contracts[].id', link('a', {
      contracts: [{ id: 'platform:store', version: '1.0.0' }],
      kinds: []
    })],
    ['kinds[].provides[].id', link('a', {
      contracts: [],
      kinds: [{ key: 'k', version: '1.0.0', provides: [{ id: 'platform:store', version: '1.0.0' }], ports: [] }]
    })],
    ['contracts[].requires[].contract', link('a', {
      contracts: [{ id: 'C', version: '1.0.0', requires: [{ contract: 'platform:store', range: '^1.0.0' }] }],
      kinds: [{ key: 'k', version: '1.0.0', provides: [], ports: [] }]
    })]
  ]
  for (const [what, raw] of refused) {
    try {
      manifest.parse(raw)
      assert.fail(`manifest.parse now accepts a platform id at ${what}, so visible() must seed the namespace`)
    } catch (err) {
      threw(err)
      assert.ok(err.message.includes('platform:store'), `${what}: ${err.message}`)
    }
  }

  // And the one place a `platform:` id *is* legal stays legal, so this case
  // cannot pass by the parser having simply banned the prefix outright.
  const port = manifest.parse(link('a', {
    contracts: [],
    kinds: [{
      key: 'k',
      version: '1.0.0',
      provides: [],
      ports: [{ name: 'p', contract: 'platform:store', range: '^1.0.0', cardinality: 'one' }]
    }]
  }))
  assert.equal(port.kinds[0].ports[0].contract, 'platform:store')
})

/* ──────────────────────────────── cycles ───────────────────────────────── */

test('a cycle is named rather than hung on, and is not an error', () => {
  const raws = [
    link('x', {
      deps: [{ name: 'y', range: '^1.0.0' }],
      contracts: [{ id: 'X', version: '1.0.0' }],
      kinds: [{
        key: 'x',
        version: '1.0.0',
        provides: [{ id: 'X', version: '1.0.0' }],
        ports: [{ name: 'y', contract: 'Y', range: '^1.0.0', cardinality: 'one' }]
      }]
    }),
    link('y', {
      deps: [{ name: 'x', range: '^1.0.0' }],
      contracts: [{ id: 'Y', version: '1.0.0' }],
      kinds: [{
        key: 'y',
        version: '1.0.0',
        provides: [{ id: 'Y', version: '1.0.0' }],
        ports: [{ name: 'x', contract: 'X', range: '^1.0.0', cardinality: 'one' }]
      }]
    })
  ]
  const v = chain.validate(parseAll(raws), [
    { id: 'x', artifact: 'x', kind: 'x', bindings: { y: 'y' } },
    { id: 'y', artifact: 'y', kind: 'y', bindings: { x: 'x' } }
  ])
  // Legal, and `assemble.js` argues why at length. Reported, so nobody has to
  // discover it as a build order that came out surprising.
  assert.equal(v.ok, true, chain.explain(v))
  assert.equal(JSON.stringify(v.cycles), JSON.stringify([['x', 'y']]))
})

test('one cycle reached from three entry points is one cycle', () => {
  const raws = [1, 2, 3].map((n) => link(`n${n}`, {
    deps: [1, 2, 3].filter((m) => m !== n).map((m) => ({ name: `n${m}`, range: '^1.0.0' })),
    contracts: [{ id: `N${n}`, version: '1.0.0' }],
    kinds: [{
      key: 'k',
      version: '1.0.0',
      provides: [{ id: `N${n}`, version: '1.0.0' }],
      ports: [{ name: 'next', contract: `N${(n % 3) + 1}`, range: '^1.0.0', cardinality: 'one' }]
    }]
  }))
  const v = chain.validate(parseAll(raws), [
    { id: 'n1', artifact: 'n1', kind: 'k', bindings: { next: 'n2' } },
    { id: 'n2', artifact: 'n2', kind: 'k', bindings: { next: 'n3' } },
    { id: 'n3', artifact: 'n3', kind: 'k', bindings: { next: 'n1' } }
  ])
  assert.equal(JSON.stringify(v.cycles), JSON.stringify([['n1', 'n2', 'n3']]))
  // And every instance still got a path, including ones no root points into.
  for (const p of v.problems) assert.ok(p.path.length > 0)
})

test('an instance bound to itself terminates and is not called a cycle of one', () => {
  const raws = [link('s', {
    contracts: [{ id: 'S', version: '1.0.0' }],
    kinds: [{
      key: 's',
      version: '1.0.0',
      provides: [{ id: 'S', version: '1.0.0' }],
      ports: [{ name: 'self', contract: 'S', range: '^1.0.0', cardinality: 'one' }]
    }]
  })]
  const v = chain.validate(parseAll(raws), [{ id: 's', artifact: 's', kind: 's', bindings: { self: 's' } }])
  assert.equal(v.ok, true, chain.explain(v))
  assert.equal(JSON.stringify(v.cycles), '[]')
})

/* ───────────────────────── platform and config ─────────────────────────── */

test('every native token is @ plus the contract\'s own final segment', () => {
  // The rule, asserted as a rule rather than as six remembered strings. Two
  // entries used to abbreviate — `platform:documentation` minted `@docs` and
  // `platform:network-view` minted `@view` — and four did not, so there was a
  // four-wide convention and two exceptions, which is a convention nothing checks.
  //
  // The abbreviations were the whole of why `@docs` collided with the artifact
  // name `docs` and `@view` with the contract id `view@1.1.0`: `boot.js` strips
  // the `@` and switches on the bare token, which puts it in the same string
  // space as every name an author chooses. Derive the token here and an
  // abbreviation cannot come back without this case failing.
  for (const [contract, mint] of Object.entries(chain.NATIVE)) {
    assert.ok(contract.startsWith('platform:'), contract)
    const segment = contract.slice('platform:'.length)
    const minted = mint({ artifact: 'a', instance: 'i' })
    // Scope is appended after the token, so the token is what precedes the first
    // `:` — and asserting on the whole string would make this a test about
    // scoping, which the header above it argues separately.
    assert.equal(minted.split(':')[0], `@${segment}`, `${contract} mints ${minted}`)
  }
})

test('a platform port the runtime does not provide is named', () => {
  const raws = [link('p', {
    contracts: [{ id: 'P', version: '1.0.0' }],
    kinds: [{
      key: 'p',
      version: '1.0.0',
      provides: [{ id: 'P', version: '1.0.0' }],
      ports: [{ name: 'weird', contract: 'platform:telepathy', range: '^1.0.0', cardinality: 'one' }]
    }]
  })]
  const v = chain.validate(parseAll(raws), [
    { id: 'p', artifact: 'p', kind: 'p', bindings: { weird: '@telepathy' } }
  ])
  assert.equal(of(v, 'UNKNOWN_PLATFORM_PORT').length, 1)
})

test('a real platform port is not mistaken for a missing instance', () => {
  const raws = [link('p', {
    contracts: [{ id: 'P', version: '1.0.0' }],
    kinds: [{
      key: 'p',
      version: '1.0.0',
      provides: [{ id: 'P', version: '1.0.0' }],
      ports: [{ name: 'view', contract: 'platform:network-view', range: '^1.0.0', cardinality: 'one' }]
    }]
  })]
  const v = chain.validate(parseAll(raws), [{ id: 'p', artifact: 'p', kind: 'p', bindings: { view: '@network-view' } }])
  assert.equal(v.ok, true, chain.explain(v))
})

test('config is held to the schema its kind declared, before anything runs', () => {
  const raws = [link('cfg', {
    contracts: [{ id: 'G', version: '1.0.0' }],
    kinds: [{
      key: 'g',
      version: '1.0.0',
      provides: [{ id: 'G', version: '1.0.0' }],
      ports: [],
      config: { type: 'object', fields: { retries: { type: 'number' } } }
    }]
  })]
  const manifests = parseAll(raws)
  assert.equal(chain.validate(manifests, [{ id: 'g', artifact: 'cfg', kind: 'g', bindings: {}, config: { retries: 3 } }]).ok, true)
  // The typo config validation exists for — and it is two faults, not one. The
  // key nobody declared, and the required one it was meant to be. Reporting only
  // the first is how an operator finds the second on the next boot.
  const typo = chain.validate(manifests, [{ id: 'g', artifact: 'cfg', kind: 'g', bindings: {}, config: { retires: 3 } }])
  const bad = of(typo, 'BAD_CONFIG')
  assert.equal(bad.length, 2, chain.explain(typo))
  assert.ok(bad.some((p) => /config\.retires is not a field of this object/.test(p.message)), chain.explain(typo))
  assert.ok(bad.some((p) => /config\.retries is required/.test(p.message)), chain.explain(typo))
})

/** A kind whose config is four declared fields, two of them optional. */
const configured = () => parseAll([link('cfg', {
  contracts: [{ id: 'G', version: '1.0.0' }],
  kinds: [{
    key: 'g',
    version: '1.0.0',
    provides: [{ id: 'G', version: '1.0.0' }],
    ports: [],
    config: {
      type: 'object',
      fields: {
        retries: { type: 'number' },
        name: { type: 'string' },
        deep: { type: 'object', optional: true, fields: { a: { type: 'number' }, b: { type: 'number' } } },
        maybe: { type: 'boolean', optional: true }
      }
    }
  }]
})])

const configured1 = (/** @type {any} */ config) =>
  chain.validate(configured(), [{ id: 'g', artifact: 'cfg', kind: 'g', bindings: {}, config }])

test('four wrong keys in one config object are four problems', () => {
  // The failure this module exists to end, in the one place it survived: an
  // operator fixing a config object one boot at a time. `contract.validate`
  // throws on the first bad key, which is right for a door and wrong for a
  // report, so the fields are walked here and every verdict is still its.
  const v = configured1({ retries: 'x', name: 4, nope: 1, alsoNope: 2 })
  const bad = of(v, 'BAD_CONFIG')
  assert.equal(bad.length, 4, chain.explain(v))

  // Both undeclared keys, not one: N unknown keys are N things to fix.
  assert.equal(bad.filter((p) => /is not a field of this object/.test(p.message)).length, 2, chain.explain(v))
  assert.ok(bad.some((p) => /config\.nope is not a field/.test(p.message)), chain.explain(v))
  assert.ok(bad.some((p) => /config\.alsoNope is not a field/.test(p.message)), chain.explain(v))

  // And both declared keys holding the wrong type, in the validator's words at
  // the path the validator would have used.
  assert.ok(bad.some((p) => p.message === 'g.config.retries must be a number, got string'), chain.explain(v))
  assert.ok(bad.some((p) => p.message === 'g.config.name must be a string, got number'), chain.explain(v))
})

test('a config that satisfies its schema is not a fault, however many optionals it leaves out', () => {
  // The negative, as hard as the positive. A per-field walk that invented a
  // problem for every absent optional would report four faults on a correct
  // object and would be worse than the single-problem version it replaced.
  assert.equal(configured1({ retries: 1, name: 'a' }).ok, true, chain.explain(configured1({ retries: 1, name: 'a' })))
  const full = configured1({ retries: 1, name: 'a', maybe: false, deep: { a: 1, b: 2 } })
  assert.equal(full.ok, true, chain.explain(full))
})

test('config is checked as the value the realm receives, and structure is one fault', () => {
  // `{}` and not `spec.config`: a kind whose fields are all optional is satisfied
  // by an empty object, and what is checked has to be what `build` is handed. So
  // no config at all is judged against the schema rather than skipped, and the
  // two required fields are both named.
  assert.equal(of(configured1(undefined), 'BAD_CONFIG').length, 2, chain.explain(configured1(undefined)))

  // And a config that is not an object has no keys to enumerate. One message,
  // the validator's, rather than a walk over something that cannot be walked.
  for (const [what, value] of [['a number', 7], ['an array', []], ['a string', 'x']]) {
    const v = configured1(value)
    const bad = of(v, 'BAD_CONFIG')
    assert.equal(bad.length, 1, `${what}: ${chain.explain(v)}`)
    assert.ok(/^g\.config must be an object, got /.test(bad[0].message), `${what}: ${bad[0].message}`)
  }
})

test('two bad keys inside one nested object are two problems', () => {
  // The limit this module used to state and no longer has. A field that is itself
  // an object was handed to `contract.validate` whole, so this reported one fault
  // and it was the first of them; `contract.faults` walks the whole value, so
  // both come back with distinct paths.
  const v = configured1({ retries: 1, name: 'a', deep: { a: 'x', b: 'y' } })
  const bad = of(v, 'BAD_CONFIG')
  assert.equal(bad.length, 2, chain.explain(v))
  assert.equal(bad[0].message, 'g.config.deep.a must be a number, got string')
  assert.equal(bad[1].message, 'g.config.deep.b must be a number, got string')

  // And a nested fault does not cost a top-level one, or the other way about.
  const both = configured1({ retries: 'x', deep: { a: 'x', b: 'y' } })
  assert.equal(of(both, 'BAD_CONFIG').length, 4, chain.explain(both))
})

/**
 * A config schema three objects deep, with a map and an open object at the
 * bottom, which is the arrangement the one-level-deep enumeration could say
 * nothing useful about.
 */
const nested = () => parseAll([link('cfg', {
  contracts: [{ id: 'G', version: '1.0.0' }],
  kinds: [{
    key: 'g',
    version: '1.0.0',
    provides: [{ id: 'G', version: '1.0.0' }],
    ports: [],
    config: {
      type: 'object',
      fields: {
        limits: {
          type: 'object',
          fields: {
            window: { type: 'object', fields: { ms: { type: 'number' }, jitter: { type: 'number' } } },
            tags: { type: 'object', values: { type: 'string' } },
            profile: { type: 'object', open: true, fields: { width: { type: 'number' } } }
          }
        }
      }
    }
  }]
})])

const nested1 = (/** @type {any} */ config) =>
  chain.validate(nested(), [{ id: 'g', artifact: 'cfg', kind: 'g', bindings: {}, config }])

test('two faults two levels down are two problems, with the path to each', () => {
  // The case the old enumeration could not report at all: `limits` went to the
  // validator whole, so `window.ms` and `window.jitter` — three levels down —
  // were one problem between them.
  const v = nested1({ limits: { window: { ms: 'a', jitter: false }, tags: {}, profile: { width: 1 } } })
  const bad = of(v, 'BAD_CONFIG')
  assert.equal(bad.length, 2, chain.explain(v))
  const said = bad.map((p) => p.message)
  assert.ok(said.includes('g.config.limits.window.ms must be a number, got string'), chain.explain(v))
  assert.ok(said.includes('g.config.limits.window.jitter must be a number, got boolean'), chain.explain(v))
  // Distinct paths, which is the whole of what "with the path to each" buys: two
  // faults a reader can tell apart and fix in one pass.
  assert.equal(new Set(said).size, 2, chain.explain(v))
})

test('a nested map reports every bad value, and a nested open object still checks its own', () => {
  const v = nested1({
    limits: {
      window: { ms: 1, jitter: 1 },
      // A map at depth: every key against one schema, no key unknown.
      tags: { a: 1, b: 'fine', c: false },
      // `open` at depth skips the unknown-key rejection and nothing else, so
      // `spare` passes and `width` is held to its type exactly as hard.
      profile: { width: 'wide', spare: 'anything' }
    }
  })
  const bad = of(v, 'BAD_CONFIG').map((p) => p.message)
  assert.equal(bad.length, 3, chain.explain(v))
  assert.ok(bad.includes('g.config.limits.tags.a must be a string, got number'), chain.explain(v))
  assert.ok(bad.includes('g.config.limits.tags.c must be a string, got boolean'), chain.explain(v))
  assert.ok(bad.includes('g.config.limits.profile.width must be a number, got string'), chain.explain(v))
  assert.ok(bad.every((m) => !/spare/.test(m)), `open let nothing through: ${chain.explain(v)}`)

  // And the negative: the same shape, correct, is clean — including an unknown
  // key inside the open object and an empty map.
  const ok = nested1({ limits: { window: { ms: 1, jitter: 2 }, tags: {}, profile: { width: 80, spare: 'x' } } })
  assert.equal(ok.ok, true, chain.explain(ok))
})

test('the first BAD_CONFIG on an instance is the message its boot would have died on', () => {
  // The property that decides the ordering. `contract.faults` walks in document
  // order and this module's sort is stable, so the earliest fault in the report is
  // `contract.validate`'s throw — the door `assemble.js` runs. Sorting these by
  // path would read more tidily and would cost exactly this.
  const config = { limits: { window: { ms: 'a', jitter: false }, tags: { z: 1 }, profile: { width: 'wide' } } }
  const v = nested1(config)
  const bad = of(v, 'BAD_CONFIG')
  assert.equal(bad.length, 4, chain.explain(v))

  const { contract } = require('artifact-protocol')
  const schema = nested().cfg.kinds[0].config
  if (schema === undefined) assert.fail('the fixture lost its config schema')
  try {
    contract.validate(config, schema, 'g.config')
    assert.fail('the door should have refused this config')
  } catch (err) {
    threw(err)
    assert.equal(bad[0].message, err.message, chain.explain(v))
  }
})

test('the same inputs report the same problems in the same order, every time', () => {
  // Determinism, asserted rather than assumed. Every fault of one config object
  // shares an instance, a port and a code, so the order is the traversal's — which
  // is why `contract.faults` states document order as part of its contract.
  const config = { retries: 'x', name: 4, nope: 1, alsoNope: 2, deep: { a: 'x', b: 'y' } }
  const report = () => of(configured1(config), 'BAD_CONFIG').map((p) => p.message)
  const once = report()
  // Joined rather than compared element by element: `bare-assert` has no
  // `deepEqual`, and one string per run is what "the same bytes" actually means.
  for (let i = 0; i < 3; i++) assert.equal(report().join('\n'), once.join('\n'))
  assert.equal(once.length, 6, once.join(' | '))
})

test('a config schema that never went through the parser costs the config and not the verdict', () => {
  // `nothing here throws` is a promise to `boot.js`, and it has to survive a
  // hand-built manifest reaching past `manifest.parse` — the same way the
  // malformed-range case below does. One guard, one problem, verdict intact.
  const set = configured()
  set.cfg.kinds[0].config = /** @type {any} */ (null)
  const v = chain.validate(set, [{ id: 'g', artifact: 'cfg', kind: 'g', bindings: {}, config: { retries: 1 } }])
  const bad = of(v, 'BAD_CONFIG')
  assert.equal(bad.length, 1, chain.explain(v))
  assert.ok(/^g\.config could not be checked: /.test(bad[0].message), bad[0].message)
})

test('a map-shaped config is enumerated too, and has no unknown keys', () => {
  // `values` rather than `fields`: every key is checked against one schema and no
  // key can be undeclared, so three bad values are three problems.
  const set = parseAll([link('cfg', {
    contracts: [{ id: 'G', version: '1.0.0' }],
    kinds: [{
      key: 'g',
      version: '1.0.0',
      provides: [{ id: 'G', version: '1.0.0' }],
      ports: [],
      config: { type: 'object', values: { type: 'number' } }
    }]
  })])
  const v = chain.validate(set, [{ id: 'g', artifact: 'cfg', kind: 'g', bindings: {}, config: { a: 'x', b: 'y', c: 3, d: false } }])
  const bad = of(v, 'BAD_CONFIG')
  assert.equal(bad.length, 3, chain.explain(v))
  assert.ok(bad.every((p) => /^g\.config\.[abd] must be a number/.test(p.message)), chain.explain(v))
})

test('config for a kind that declared no schema is a setting nothing reads', () => {
  const raws = [link('cfg', {
    contracts: [{ id: 'G', version: '1.0.0' }],
    kinds: [{ key: 'g', version: '1.0.0', provides: [{ id: 'G', version: '1.0.0' }], ports: [] }]
  })]
  const v = chain.validate(parseAll(raws), [{ id: 'g', artifact: 'cfg', kind: 'g', bindings: {}, config: { x: 1 } }])
  assert.equal(of(v, 'UNDECLARED_CONFIG').length, 1)
})

/**
 * A pair: `app` declares a range on `lib`, and `lib` is in the set at `version`.
 * @param {string} range @param {string} version
 */
const pair = (range, version) => {
  const kinds = [{ key: 'k', version: '1.0.0', provides: [], ports: [] }]
  return parseAll([
    link('app', { deps: [{ name: 'lib', range }], contracts: [], kinds }),
    link('lib', { contracts: [], kinds, version })
  ])
}

const BOTH = [
  { id: 'a', artifact: 'app', kind: 'k', bindings: {} },
  { id: 'l', artifact: 'lib', kind: 'k', bindings: {} }
]

test('a dep present at a version its own declaration excludes is a problem', () => {
  // The range on a `deps` entry was compared **nowhere** in this tree. Every
  // other `satisfies` call is against a port's range or a requirement's, which
  // are a different statement: the network's `base[].range` says what a network
  // ships, and only that half was ever enforced.
  //
  // What made it concrete: an adapter bound to an older `artifact-cli` that
  // lacked operations it called, and died with `deps.parser.plan is not a
  // function` when somebody typed a command — a runtime failure for a fault
  // sitting in two documents an admin could have been shown before signing.
  const v = chain.validate(pair('^2.0.0', '1.5.0'), BOTH)

  assert.equal(of(v, 'DEP_OUT_OF_RANGE').length, 1)
  assert.equal(v.ok, false)

  const [p] = of(v, 'DEP_OUT_OF_RANGE')
  // Both versions named, because the repair is editing one of two documents and
  // the message should not make an admin go and look up which is which.
  assert.ok(p.message.includes('app@1.0.0'), p.message)
  assert.ok(p.message.includes('lib ^2.0.0'), p.message)
  assert.ok(p.message.includes('lib@1.5.0'), p.message)
})

test('a dep the set simply does not hold is not a problem, which is the whole distinction', () => {
  // Absent is legitimate by design — AGENTS.md §3 says `deps` states what you
  // may talk to, not what gets installed, and `send` running without `qr` is the
  // intended case. Refusing it here would enforce an install closure the planner
  // deliberately refuses to walk, and would make this check the strictest thing
  // in the tree rather than the narrowest.
  const set = pair('^2.0.0', '1.5.0')
  delete set.lib

  const v = chain.validate(set, [BOTH[0]])
  assert.equal(of(v, 'DEP_OUT_OF_RANGE').length, 0)
})

test('a dep in range says nothing at all', () => {
  // The control. Without it the case above passes against a checker that flags
  // every dep it can see, which would be the same defect facing the other way.
  const v = chain.validate(pair('^2.0.0', '2.1.0'), BOTH)
  assert.equal(of(v, 'DEP_OUT_OF_RANGE').length, 0)
  assert.equal(v.ok, true, JSON.stringify(v.problems))
})

test('a manifest filed under a key that is not its name is reported, not silently half-resolved', () => {
  // Everything above resolves a dep by writing `set[d.name]` — the name the
  // *declaring* manifest wrote down. `boot.js` fills that map with
  // `manifests[want.artifact]`, the name the network's signed state asked for.
  // The two agree, and being sure of it takes three checks in three other files:
  // `release.verify` refuses a record whose name is not the one requested,
  // `source.fetch` is what requests, and `bundle.js:82` refuses a drive whose
  // manifest disagrees with its release.
  //
  // Three distant guards holding an invariant used here is true by luck. This
  // used to be a comment saying so, which is worth less than the check: relax
  // any one of those guards and the lookup starts missing *silently*, because a
  // miss is indistinguishable from a dep the set does not hold — so the artifact
  // is judged against fewer declarations than it has and every port still
  // validates. Nothing goes red; the graph is simply checked less.
  const set = pair('^2.0.0', '2.1.0')
  set.wrong = set.lib
  delete set.lib

  const v = chain.validate(set, [BOTH[0]])
  assert.equal(of(v, 'MISFILED_MANIFEST').length, 1, JSON.stringify(v.problems))
  assert.equal(v.ok, false)

  // Both spellings named, because the repair is to one of them and the message
  // must not make an admin work out which map they are looking at.
  const [p] = of(v, 'MISFILED_MANIFEST')
  assert.ok(p.message.includes('"lib"'), p.message)
  assert.ok(p.message.includes('"wrong"'), p.message)
})

test('a set filed correctly says nothing, including the one this platform ships', () => {
  // The control, and the half that actually matters: an over-eager version of
  // the check above would fire on every real set and make `validate` useless.
  assert.equal(of(chain.validate(pair('^2.0.0', '2.1.0'), BOTH), 'MISFILED_MANIFEST').length, 0)

  // A manifest with no `name` at all is not misfiled — it is a different fault,
  // and one `manifest.parse` already refuses. Claiming it here would report two
  // problems for one cause and send the reader to the wrong document.
  const set = pair('^2.0.0', '2.1.0')
  delete set.lib.name
  assert.equal(of(chain.validate(set, BOTH), 'MISFILED_MANIFEST').length, 0)
})

test('a range that does not parse costs that dep and not the verdict', () => {
  // Reached past the parser, the way the sibling case below does it and the way
  // a hand-built manifest can. Writing `not-a-range` into the fixture instead
  // proves nothing about this module: `manifest.parse` refuses it outright with
  // `INVALID_VERSION`, so the string never arrives. I tried that first and the
  // failure was the test's premise, not the code's.
  //
  // That refusal is the real first line of defence, and it is why the local
  // non-throwing `satisfies` here is belt and braces rather than the guard. It
  // still earns its place: this module is a reporter over documents it did not
  // verify — `network check` runs it over unsigned state an admin is still
  // editing — so a bad range has to be a finding beside the others rather than
  // an exception that abandons the rest of the report. `assemble.js` calls the
  // throwing one for the opposite reason, and both are right.
  const set = pair('^2.0.0', '2.1.0')
  set.app.deps[0] = { ...set.app.deps[0], range: 'not a range' }

  const v = chain.validate(set, BOTH)
  assert.equal(of(v, 'DEP_OUT_OF_RANGE').length, 1, chain.explain(v))
  assert.equal(v.problems.length, 1, 'it took the rest of the verdict with it')
})

test('two instances with one id are refused rather than silently deduplicated', () => {
  const raws = four()
  const v = chain.validate(parseAll(raws), [
    { id: 'd', artifact: 'd', kind: 'd', bindings: {} },
    { id: 'd', artifact: 'd', kind: 'd', bindings: {} }
  ])
  assert.equal(of(v, 'DUPLICATE_INSTANCE').length, 1)
})

/* ─────────────────────────── it does not throw ─────────────────────────── */

test('nothing here throws, whatever it is handed', () => {
  for (const [m, s] of [
    [null, null],
    [{}, []],
    [parseAll(four()), [{ id: 'x', artifact: 'a', kind: 'a', bindings: { b: null } }]],
    [parseAll(four()), [{ id: 'x', artifact: 'a', kind: 'a' }]]
  ]) {
    const v = chain.validate(/** @type {any} */ (m), /** @type {any} */ (s))
    assert.ok(typeof v.ok === 'boolean')
    assert.ok(Array.isArray(v.problems))
  }
})

test('a malformed range costs the port and not the whole verdict', () => {
  const raws = four()
  const manifests = parseAll(raws)
  // Reached past the parser, the way a hand-built manifest can be.
  manifests.a.kinds[0].ports[0] = { ...manifests.a.kinds[0].ports[0], range: 'not a range' }
  const v = chain.validate(manifests, wired())
  assert.equal(of(v, 'VERSION_OUT_OF_RANGE').length, 1, chain.explain(v))
  // And the rest of the graph was still checked.
  assert.equal(v.problems.every((p) => p.path.length > 0), true)
})

/* ──────────────────────────────── run them ─────────────────────────────── */

t.plan(cases.length)

for (const [name, fn] of cases) {
  try {
    fn()
    t.pass(name)
  } catch (err) {
    threw(err)
    t.fail(`${name} — ${err instanceof Error ? err.message : err}`)
  }
}
