/**
 * Deriving the wiring, which used to be a file the device owner could edit.
 *
 * The planner is a pure function, so this suite is where most of the evidence
 * about the derived graph lives — the integration tests prove it runs, and
 * these prove it is *right*, including in the cases that are hard to stand up
 * over a real network.
 *
 * The negative cases matter more than the positive ones. A planner that binds
 * too much is a planner that hands an artifact a capability nobody granted it.
 *
 * ## What is here and what stayed in `artifact-platform`
 *
 * This file was `ArtifactPatform/test/plan.test.js`, sixty cases; forty-nine are
 * below and eleven stayed, by the same rule `chain.test.js` here states: a case
 * whose subject is the **shipped artifact set** belongs where that set is
 * assembled. Those eleven load the real manifests of `artifact-cli`,
 * `artifact-macos`, `artifact-send`, `artifact-ui`, `artifact-docs`,
 * `artifact-qr`, `artifact-linux` and `artifact-windows` and assert what a
 * network made of them derives — the five default instance ids, the three
 * adapters coexisting, the two shipped `cli` shapes giving the substitution check
 * real cross-version traffic. Moving them would have put eight `file:../` links
 * to artifact repositories in this package's manifest, so a pure documents-in
 * library could not be installed or tested without the concrete artifacts it
 * exists to judge. That is not the cycle `artifact-lan` avoided; it is the same
 * inversion one repository further along, and it is the reason the split of the
 * suite falls in a different place from the split of the code again.
 *
 * Everything below is a fixture, and the division is deliberate rather than
 * convenient: a fixture proves the *rule*, and the shipped stack proves the rule
 * is wired to the artifacts that ship, which is a separate claim that only the
 * repo holding those artifacts can make.
 *
 * One case is worth naming because it took a guard with it. *A view with no
 * instances derives exactly the graph it derived before* is the regression guard
 * for the `instance.create` section here, and it is over the shipped stack — it
 * hardcodes the five ids — so it went with the other ten rather than being
 * rewritten against `world()`. The equivalence it asserts is now checked in
 * `artifact-platform`'s suite and nowhere here, which is a fact about where the
 * assertion lives and not a case that was dropped: the split is
 * total-neutral, 60 = 49 + 11, and a total that fell would have meant coverage
 * discarded rather than relocated.
 */
const t = require('bare-tap')
const assert = require('bare-assert')
const { manifest: Manifest } = require('artifact-protocol')

const { plan, PlanError } = require('../lib/plan')

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
const test = (/** @type {string} */ n, /** @type {any} */ f) => cases.push([n, f])

/**
 * `[m] = []` used to stand where `m` does, and it was a bug the checker found:
 * destructuring the third argument means `same(a, b, 'only what the network
 * asked for')` binds `m` to `"o"` — the first *character* of the message, since
 * a string is iterable. Every explanatory message in this file was being thrown
 * away and reported as one letter. Nothing about which assertions pass changes
 * by fixing it; what changes is that a failure now says why.
 *
 * @param {unknown} a @param {unknown} b @param {string} [m]
 */
const same = (a, b, m) =>
  assert.equal(JSON.stringify(a), JSON.stringify(b), m ?? `${JSON.stringify(a)} !== ${JSON.stringify(b)}`)

/** @param {object} m */
const parse = (m) => Manifest.parse(m)

/** @typedef {import('artifact-protocol/manifest').Cardinality} Cardinality */
/** @typedef {import('artifact-protocol/manifest').ProvidedRef} ProvidedRef */
/** @typedef {import('artifact-protocol/manifest').ContractDecl} ContractDecl */
/** @typedef {{ name: string, contract: string, range: string, cardinality: Cardinality }} Port */

/**
 * `cardinality` is the protocol's `Cardinality` and not a bare `string`, because
 * a fixture that asked for `'onee'` would otherwise sail past `tsc` and fail
 * inside `Manifest.parse` with a message about a manifest rather than a typo.
 *
 * @param {string} name @param {string} contract @param {Cardinality} cardinality
 * @returns {Port}
 */
const port = (name, contract, cardinality) =>
  ({ name, contract, range: '^1.0.0', cardinality })

const ref = (/** @type {string} */ id) => ({ id, version: '1.0.0' })

/**
 * A one-kind artifact.
 *
 * A dependency is added for any contract the manifest does not declare itself,
 * because `Manifest.parse` refuses a manifest with no deps that names a contract
 * it could not possibly obtain — a real check, and noise in a fixture.
 *
 * Every option needs a type, and not because `Manifest.parse` cares: it takes
 * `unknown` and validates at runtime. Without them the destructured defaults
 * infer from the *defaults* — `provides` becomes `never[]`, `contracts` becomes
 * `null` — and every call site that passes anything is an error about `never`.
 * `provides` takes a bare string as shorthand for "provides this contract at
 * 1.0.0", which is what most cases here want, and `contracts` distinguishes
 * `null` ("derive them from `provides`") from `[]` ("declare none"), which is a
 * distinction several cases turn on.
 *
 * @param {string} name
 * @param {object} [over]
 * @param {(string | ProvidedRef)[]} [over.provides]
 * @param {Port[]} [over.ports]
 * @param {ContractDecl[] | null} [over.contracts]
 * @param {{ name: string, range: string }[]} [over.deps]
 * @param {{ id: string, description: string }[]} [over.permissions]
 */
function artifact (name, { provides = [], ports = [], contracts = null, deps = [], permissions = [] } = {}) {
  // The shorthand, resolved once. `p.id ?? p` stood here and read the same way,
  // but only because a string has no `id` — spelling the branch out is what lets
  // the checker follow it, and it is what the `kinds.provides` line below has
  // always done.
  const declaredRefs = () => provides.map((p) => (typeof p === 'string' ? ref(p) : ref(p.id)))
  const declared = new Set((contracts ?? declaredRefs()).map((c) => c.id))
  const external = ports
    .map((p) => p.contract)
    .filter((c) => !c.startsWith('platform:') && !declared.has(c))

  const allDeps = [...deps]
  for (const c of new Set(external)) {
    if (!allDeps.some((d) => d.name === c)) allDeps.push({ name: c, range: '^1.0.0' })
  }

  return parse({
    name,
    version: '1.0.0',
    entry: '/index.js',
    deps: allDeps,
    contracts: contracts ?? declaredRefs(),
    permissions,
    kinds: [{
      key: name,
      version: '1.0.0',
      lifetime: 'scoped',
      provides: provides.map((p) => (typeof p === 'string' ? ref(p) : p)),
      ports
    }]
  })
}

const byId = (/** @type {any[]} */ specs, /** @type {string} */ id) => specs.find((s) => s.id === id)

/* ────────────────────── the shape of the derived graph ──────────────────── */

test('one artifact with one kind becomes one instance named for it', () => {
  const specs = plan({ qr: artifact('qr', { provides: ['qr-encoder'] }) })
  same(specs.map((s) => s.id), ['qr'])
  assert.equal(specs[0].artifact, 'qr')
  assert.equal(specs[0].kind, 'qr')
})

test('an artifact with several kinds gets one instance each, disambiguated', () => {
  const ui = parse({
    name: 'ui',
    version: '1.0.0',
    entry: '/index.js',
    contracts: [ref('renderer'), ref('view')],
    kinds: [
      { key: 'text-renderer', version: '1.0.0', lifetime: 'scoped', provides: [ref('renderer')], ports: [] },
      { key: 'shell', version: '1.0.0', lifetime: 'scoped', provides: [], ports: [port('renderer', 'renderer', 'one'), port('panels', 'view', 'many')] }
    ]
  })
  const specs = plan({ ui })
  same(specs.map((s) => s.id), ['ui.shell', 'ui.text-renderer'])
  assert.equal(byId(specs, 'ui.shell').bindings.renderer, 'ui.text-renderer')
})

test('the output is sorted, so two devices derive the same graph', () => {
  const manifests = {
    zebra: artifact('zebra'),
    alpha: artifact('alpha'),
    middle: artifact('middle')
  }
  same(plan(manifests).map((s) => s.id), ['alpha', 'middle', 'zebra'])
})

/* ──────────────────────── platform capabilities ─────────────────────────── */

test('a platform port becomes a native target, scoped by the rules in plan.js', () => {
  const send = artifact('send', {
    contracts: [],
    ports: [
      port('view', 'platform:network-view', 'one'),
      port('feed', 'platform:feed', 'one'),
      port('blobs', 'platform:blobs', 'one'),
      port('kv', 'platform:store', 'one'),
      port('host', 'platform:host', 'one')
    ]
  })
  const { bindings } = plan({ send })[0]
  assert.equal(bindings.view, '@network-view', 'one view per network')
  assert.equal(bindings.feed, '@feed:send', 'feeds are per artifact')
  assert.equal(bindings.blobs, '@blobs:send')
  assert.equal(bindings.kv, '@store:send', 'a store is per instance')
  assert.equal(bindings.host, '@host')
})

test('a store is per instance, so two kinds of one artifact do not share one', () => {
  const twin = parse({
    name: 'twin',
    version: '1.0.0',
    entry: '/index.js',
    contracts: [],
    kinds: ['a', 'b'].map((key) => ({
      key, version: '1.0.0', lifetime: 'scoped', provides: [], ports: [port('kv', 'platform:store', 'one')]
    }))
  })
  const specs = plan({ twin })
  assert.equal(byId(specs, 'twin.a').bindings.kv, '@store:twin.a')
  assert.equal(byId(specs, 'twin.b').bindings.kv, '@store:twin.b')
  assert.notEqual(byId(specs, 'twin.a').bindings.kv, byId(specs, 'twin.b').bindings.kv)
})

test('a feed is per artifact, so two kinds of one artifact do share one', () => {
  // Two instances of one program are two copies of the same thing and have to
  // see the same stream. This is the deliberate other half of the store rule.
  const twin = parse({
    name: 'twin',
    version: '1.0.0',
    entry: '/index.js',
    contracts: [],
    kinds: ['a', 'b'].map((key) => ({
      key, version: '1.0.0', lifetime: 'scoped', provides: [], ports: [port('feed', 'platform:feed', 'one')]
    }))
  })
  const specs = plan({ twin })
  assert.equal(byId(specs, 'twin.a').bindings.feed, byId(specs, 'twin.b').bindings.feed)
})

test('a platform contract this runtime does not have is a failure, not an absence', () => {
  const greedy = artifact('greedy', { contracts: [], ports: [port('gpu', 'platform:gpu', 'one')] })
  try {
    plan({ greedy })
    assert.fail('a made-up platform capability was planned')
  } catch (err) {
    threw(err)
    assert.ok(err instanceof PlanError)
    assert.ok(/platform:gpu/.test(err.message), err.message)
  }
})

/* ───────────────── the isolation requirement, as configuration ──────────── */

test('an optional port with no provider is absent, not denied', () => {
  const send = artifact('send', { contracts: [], deps: [{ name: 'qr', range: '^1.0.0' }], ports: [port('qr', 'qr-encoder', 'optional')] })

  const withQr = plan({ send, qr: artifact('qr', { provides: ['qr-encoder'] }) })
  assert.equal(byId(withQr, 'send').bindings.qr, 'qr')

  const without = plan({ send })
  assert.equal('qr' in byId(without, 'send').bindings, false,
    'the port name is not in the bindings at all, so the realm never learns it')
})

test('a dependency the network did not include is not fetched in behind its back', () => {
  // A manifest's deps say what an artifact can talk to. If declaring one pulled
  // it onto the device, an author could add code to every machine running their
  // artifact by editing their own manifest, with no admin involved.
  const send = artifact('send', {
    contracts: [],
    deps: [{ name: 'qr', range: '^1.0.0' }, { name: 'spyware', range: '^1.0.0' }],
    ports: [port('qr', 'qr-encoder', 'optional')]
  })
  const specs = plan({ send })
  same(specs.map((s) => s.artifact), ['send'], 'only what the network asked for')
})

test('a required port with no provider fails loudly rather than starting broken', () => {
  const adapter = artifact('macos', { contracts: [], ports: [port('parser', 'cli-parser', 'one')] })
  try {
    plan({ macos: adapter })
    assert.fail('an unsatisfiable required port was planned')
  } catch (err) {
    threw(err)
    assert.ok(/requires cli-parser/.test(err.message), err.message)
  }
})

test('a many port is bound even when nothing provides it', () => {
  // An artifact declaring a many port has to handle zero anyway, and leaving it
  // unbound would take away the count() it uses to find that out.
  const adapter = artifact('macos', { contracts: [], ports: [port('apps', 'cli', 'many')] })
  const { bindings } = plan({ macos: adapter })[0]
  same(bindings.apps, [])
})

test('a many port collects every provider, sorted', () => {
  const adapter = artifact('macos', { contracts: [], ports: [port('apps', 'cli', 'many')] })
  const specs = plan({
    macos: adapter,
    send: artifact('send', { provides: ['cli'] }),
    ask: artifact('ask', { provides: ['cli'] })
  })
  same(byId(specs, 'macos').bindings.apps, ['ask', 'send'])
})

test('two providers for a single port is an error, not a coin toss', () => {
  const shell = artifact('shell', { contracts: [], ports: [port('renderer', 'renderer', 'one')] })
  try {
    plan({
      shell,
      ui: artifact('ui', { provides: ['renderer'] }),
      ui2: artifact('ui2', { provides: ['renderer'] })
    })
    assert.fail('an ambiguous binding was resolved by sort order')
  } catch (err) {
    threw(err)
    assert.ok(/ambiguous/.test(err.message), err.message)
    assert.ok(/ui, ui2/.test(err.message), 'and it names both')
  }
})

test('a provider whose version misses the range does not count', () => {
  const consumer = artifact('consumer', { contracts: [], ports: [{ name: 'p', contract: 'thing', range: '^2.0.0', cardinality: 'optional' }] })
  const old = artifact('old', { provides: [{ id: 'thing', version: '1.0.0' }], contracts: [ref('thing')] })
  assert.equal('p' in plan({ consumer, old })[0].bindings, false)
})

test('an artifact does not bind to itself', () => {
  const solo = artifact('solo', { provides: ['thing'], ports: [port('other', 'thing', 'optional')] })
  assert.equal('other' in plan({ solo })[0].bindings, false)
})

/* ──────────────── one instance per registered permission ────────────────── */

const permissions = artifact('permissions', {
  provides: ['permission'],
  ports: [port('view', 'platform:network-view', 'one'), port('groups', 'groups', 'optional')],
  contracts: [ref('permission')],
  deps: [{ name: 'groups', range: '^1.0.0' }]
})

const gated = artifact('send', {
  contracts: [],
  deps: [{ name: 'permissions', range: '^1.0.0' }],
  ports: [port('canShare', 'permission', 'optional')],
  permissions: [{ id: 'send.share', description: 'Offer a file to other members' }]
})

test('a registered permission becomes an instance of the permissions artifact', () => {
  const specs = plan({ permissions, send: gated }, {
    permissions: [{ id: 'send.share', artifact: 'send' }]
  })
  const instance = byId(specs, 'permission:send.share')
  assert.ok(instance, `no permission instance in ${JSON.stringify(specs.map((s) => s.id))}`)
  assert.equal(instance.artifact, 'permissions')
  same(instance.config, { id: 'send.share', description: 'Offer a file to other members' })
})

test('two registered permissions are two instances, told apart by port name', () => {
  const twoGates = artifact('send', {
    contracts: [],
    deps: [{ name: 'permissions', range: '^1.0.0' }],
    ports: [port('share', 'permission', 'optional'), port('collect', 'permission', 'optional')],
    permissions: [{ id: 'send.share', description: '' }, { id: 'send.collect', description: '' }]
  })
  const specs = plan({ permissions, send: twoGates }, {
    permissions: [{ id: 'send.share', artifact: 'send' }, { id: 'send.collect', artifact: 'send' }]
  })

  same(specs.filter((s) => s.artifact === 'permissions').map((s) => s.id),
    ['permission:send.collect', 'permission:send.share'])

  const { bindings } = byId(specs, 'send')
  assert.equal(bindings.share, 'permission:send.share')
  assert.equal(bindings.collect, 'permission:send.collect', 'each gate got its own, not the other')
})

test('two permissions and a port matching neither is an error naming the rule', () => {
  const vague = artifact('send', {
    contracts: [],
    deps: [{ name: 'permissions', range: '^1.0.0' }],
    ports: [port('canShare', 'permission', 'optional')],
    permissions: [{ id: 'send.share', description: '' }, { id: 'send.collect', description: '' }]
  })
  try {
    plan({ permissions, send: vague }, {
      permissions: [{ id: 'send.share', artifact: 'send' }, { id: 'send.collect', artifact: 'send' }]
    })
    assert.fail('an ambiguous gate was bound anyway')
  } catch (err) {
    threw(err)
    assert.ok(/name the port after the permission it gates/.test(err.message), err.message)
  }
})

test('no registered permissions means no permission instances at all', () => {
  const specs = plan({ permissions, send: gated })
  same(specs.filter((s) => s.artifact === 'permissions').map((s) => s.id), [])
  assert.equal('canShare' in byId(specs, 'send').bindings, false, 'and the gate is simply absent')
})

test('a permission port sees only permissions its own artifact registered', () => {
  // Without this narrowing every artifact would see every permission on the
  // network, and the binding would be ambiguous the moment a second artifact
  // registered one — or worse, resolvable to somebody else's gate.
  const specs = plan({ permissions, send: gated }, {
    permissions: [
      { id: 'send.share', artifact: 'send' },
      { id: 'vault.open', artifact: 'vault' }
    ]
  })
  assert.equal(byId(specs, 'send').bindings.canShare, 'permission:send.share')
})

test('a permission instance is itself wired from the view', () => {
  const specs = plan({ permissions, send: gated, groups: artifact('groups', { provides: ['groups'] }) }, {
    permissions: [{ id: 'send.share', artifact: 'send' }]
  })
  const instance = byId(specs, 'permission:send.share')
  assert.equal(instance.bindings.view, '@network-view')
  assert.equal(instance.bindings.groups, 'groups')
})

test('without the groups artifact a permission resolves from users alone', () => {
  // Phase 4's result, now reached by derivation: the same artifact, one binding
  // apart, deciding differently — and no way for the narrower one to learn that
  // groups exist.
  const specs = plan({ permissions, send: gated }, {
    permissions: [{ id: 'send.share', artifact: 'send' }]
  })
  assert.equal('groups' in byId(specs, 'permission:send.share').bindings, false)
})

/* ───────────────── instances the network signed for ─────────────────────── */

/**
 * A `send` with one of each cardinality plus a platform port, and a config
 * schema, so a signed instance of it exercises every branch of the fallback
 * rule in one fixture.
 */
const configured = parse({
  name: 'send',
  version: '1.0.0',
  entry: '/index.js',
  deps: ['qr-encoder', 'renderer', 'cli'].map((name) => ({ name, range: '^1.0.0' })),
  contracts: [],
  kinds: [{
    key: 'send',
    version: '1.0.0',
    provides: [],
    config: { type: 'object', fields: { label: { type: 'string', optional: true } } },
    ports: [
      port('qr', 'qr-encoder', 'optional'),
      port('renderer', 'renderer', 'one'),
      port('apps', 'cli', 'many'),
      port('kv', 'platform:store', 'one')
    ]
  }]
})

const world = () => ({
  send: configured,
  qr: artifact('qr', { provides: ['qr-encoder'] }),
  ui: artifact('ui', { provides: ['renderer'] }),
  cli: artifact('cli', { provides: ['cli'] })
})

/**
 * `configured`'s discretionary ports, every one of them spelled empty. A signed
 * instance's bindings are total over these, so "this instance is wired to
 * nothing" is a thing a fixture now has to say out loud — and a case that means
 * to wire one port says `{ ...NONE, qr: 'qr' }` rather than dropping the rest.
 */
const NONE = { qr: null, apps: [] }

/** @param {string} id @param {object} [over] */
const instance = (id, over = {}) => ({ id, artifact: 'send', kind: 'send', config: {}, bindings: NONE, ...over })

const refuses = (/** @type {() => void} */ fn, /** @type {RegExp} */ re, /** @type {string} */ why) => {
  try {
    fn()
    assert.fail(why)
  } catch (err) {
    threw(err)
    assert.ok(err instanceof PlanError, `${why} — ${err.message}`)
    assert.ok(re.test(err.message), err.message)
  }
}

test('a signed instance replaces the default for its kind rather than joining it', () => {
  const specs = plan(world(), { instances: [instance('send-qr', { bindings: { ...NONE, qr: 'qr' } })] })
  same(specs.map((s) => s.id), ['cli', 'qr', 'send-qr', 'ui'])
  assert.strictEqual(byId(specs, 'send'), undefined,
    'the default send survived beside the signed one, so an admin asking for one configured send got two sends')
})

test('two sends, one with qr and one without, which is the case this op exists for', () => {
  const specs = plan(world(), {
    instances: [
      instance('send-qr', { config: { label: 'With QR' }, bindings: { ...NONE, qr: 'qr' } }),
      instance('send-plain', { config: { label: 'Plain' }, bindings: NONE })
    ]
  })

  const withQr = byId(specs, 'send-qr')
  const plain = byId(specs, 'send-plain')

  assert.equal(withQr.bindings.qr, 'qr')
  assert.equal('qr' in plain.bindings, false,
    'the plain send has a name for qr, so it is not plain and the isolation claim is configuration in name only')

  same(withQr.config, { label: 'With QR' })
  same(plain.config, { label: 'Plain' })

  assert.equal(withQr.bindings.renderer, 'ui', 'a required port is still derived for both')
  assert.equal(plain.bindings.renderer, 'ui')
  assert.notEqual(withQr.bindings.kv, plain.bindings.kv, 'two instances were handed one store')
})

test('a signed instance spells its discretionary ports empty and derives the rest', () => {
  // The rule in one instance. `qr` is deliberately absent and says so with a
  // `null`; `apps` is deliberately empty and says so with a `[]`; `renderer` is
  // required, has no empty state, and is therefore still derived from the
  // network's set; `kv` is the runtime's and could not have been named.
  const signed = byId(plan(world(), { instances: [instance('lonely', { bindings: NONE })] }), 'lonely')

  assert.equal('qr' in signed.bindings, false,
    'a null target arrived at assemble.js as a key, so the realm has a name for a port the admin emptied')
  same(signed.bindings.apps, [], 'an empty many port is a binding to no targets, not the absence of a binding')
  assert.equal(signed.bindings.renderer, 'ui', 'a required port was left unbound, which is not an expressible answer')
  assert.equal(signed.bindings.kv, '@store:lonely', 'a platform port is the runtime\'s either way, unnamed and unnameable')

  // The contrast is the rule and not the fixture: the derived default instance
  // of the very same kind binds both of the ports the signed one emptied.
  const derived = byId(plan(world()), 'send')
  assert.equal(derived.bindings.qr, 'qr')
  same(derived.bindings.apps, ['cli'])
})

test('omitting a discretionary port is refused, naming it and how to spell emptiness', () => {
  // What this closes: `{}` used to mean both "this send deliberately gets no qr"
  // and "whoever wrote the op forgot qr", written identically and signed
  // identically. Nothing downstream could tell them apart, and the artifact is
  // built not to be able to — so the forgotten capability surfaced as a feature
  // mysteriously not working. Omission is no longer a spelling of anything.
  refuses(() => plan(world(), { instances: [instance('forgot-qr', { bindings: { apps: [] } })] }),
    /forgot-qr[\s\S]*qr[\s\S]*optional[\s\S]*null/, 'an optional port went missing in silence')

  refuses(() => plan(world(), { instances: [instance('forgot-apps', { bindings: { qr: null } })] }),
    /forgot-apps[\s\S]*apps[\s\S]*many[\s\S]*\[\]/, 'a many port went missing in silence')

  // And it is the *kind's* ports it is total over, not the ones that happen to
  // have a provider: dropping `qr` from the set does not excuse the omission.
  const { qr, ...noQr } = world()
  refuses(() => plan(noQr, { instances: [instance('forgot-qr', { bindings: { apps: [] } })] }),
    /does not bind qr/, 'a port with nothing to bind to stopped needing an answer')
})

test('null is the optional spelling and only that', () => {
  refuses(() => plan(world(), { instances: [instance('n', { bindings: { qr: null, apps: null } })] }),
    /apps is many[\s\S]*\[\]/, 'null was taken for an empty list')

  refuses(() => plan(world(), { instances: [instance('n', { bindings: { ...NONE, renderer: null } })] }),
    /renderer is one[\s\S]*no unbound state/, 'a required port was emptied rather than derived, which is not an answer')
})

test('a signed instance need not name a one port, and may not name a platform one', () => {
  // The two exclusions from totality, together, because they are one decision:
  // silence is only refused where it could hide a capability. A `one` port's
  // silence hides a failure this module raises by name, and a `platform:*` port
  // is not an admin's to speak about at all.
  const specs = plan(world(), { instances: [instance('quiet', { bindings: NONE })] })
  assert.equal(byId(specs, 'quiet').bindings.renderer, 'ui')

  refuses(() => plan(world(), { instances: [instance('loud', { bindings: { ...NONE, kv: 'qr' } })] }),
    /the runtime fills/, 'an op named a native target')
  refuses(() => plan(world(), { instances: [instance('loud', { bindings: { ...NONE, kv: null } })] }),
    /the runtime fills/, 'an op emptied a native target, which is naming it')
})

test('replacement is per kind, so an artifact\'s other kinds are untouched', () => {
  const ui = parse({
    name: 'ui',
    version: '1.0.0',
    entry: '/index.js',
    contracts: [ref('renderer'), ref('view')],
    kinds: [
      { key: 'text-renderer', version: '1.0.0', provides: [ref('renderer')], ports: [] },
      { key: 'shell', version: '1.0.0', provides: [], ports: [port('renderer', 'renderer', 'one'), port('panels', 'view', 'many')] }
    ]
  })
  const specs = plan({ ui }, { instances: [{ id: 'shell-a', artifact: 'ui', kind: 'shell', config: {}, bindings: { panels: [] } }] })
  same(specs.map((s) => s.id), ['shell-a', 'ui.text-renderer'])
  assert.equal(byId(specs, 'shell-a').bindings.renderer, 'ui.text-renderer')
})

test('an instance with no settings carries no config at all', () => {
  // `instance.create` always writes the field, so `{}` is how an op spells "no
  // configuration". Passing it on would fail every unconfigured signed instance
  // in `assemble.js`, which refuses config to a kind that declared no schema.
  const plain = artifact('plain', { contracts: [] })
  const specs = plan({ plain }, { instances: [{ id: 'p', artifact: 'plain', kind: 'plain', config: {}, bindings: {} }] })
  assert.equal('config' in byId(specs, 'p'), false)
})

test('the fold cannot check a create against a manifest, so every way of getting it wrong lands here', () => {
  refuses(() => plan(world(), { instances: [instance('x', { artifact: 'nowhere' })] }),
    /not in this network's set/, 'an instance named an artifact nobody fetched')

  refuses(() => plan(world(), { instances: [instance('x', { kind: 'nowhere' })] }),
    /which send does not have/, 'an instance named a kind its artifact has not got')

  refuses(() => plan(world(), { instances: [instance('x', { bindings: { ...NONE, qr: 'ghost' } })] }),
    /not an instance in this graph/, 'an instance was bound to something that does not exist')

  refuses(() => plan(world(), { instances: [instance('x', { bindings: { ...NONE, nope: 'qr' } })] }),
    /which send does not declare/, 'an instance bound a port its kind never declared')

  refuses(() => plan(world(), { instances: [instance('x', { bindings: { ...NONE, kv: 'qr' } })] }),
    /the runtime fills/, 'an op named a native target')
})

test('a signed instance cannot take over the permission set', () => {
  // How many permission instances exist is `permission.register`'s answer. If a
  // create could replace that kind, one op would silently delete a network's
  // gates — and the port narrowing that keeps `send`'s share gate out of
  // everyone else's hands is built on there being one instance per registration.
  refuses(
    () => plan({ permissions, send: gated }, {
      permissions: [{ id: 'send.share', artifact: 'send' }],
      instances: [{ id: 'perm', artifact: 'permissions', kind: 'permissions', config: {}, bindings: { groups: null } }]
    }),
    /permission\.register/,
    'a create replaced the permission instances'
  )
})

test('signed instances do not disturb the permission instances beside them', () => {
  const specs = plan({ permissions, send: gated }, {
    permissions: [{ id: 'send.share', artifact: 'send' }],
    instances: [{ id: 'send-a', artifact: 'send', kind: 'send', config: {}, bindings: { canShare: 'permission:send.share' } }]
  })
  assert.ok(byId(specs, 'permission:send.share'), 'the permission instance went missing')
  assert.equal(byId(specs, 'send-a').bindings.canShare, 'permission:send.share')
  assert.strictEqual(byId(specs, 'send'), undefined)
})

/* ──────────────── a kind that takes no default instance ─────────────────── */

/**
 * Two kinds in one artifact: one defaulted, one not. That pairing is the whole
 * of the feature and the whole of why `artifact-cli` needed it — a kind holding
 * a capability travelling in the same release as a kind everybody needs.
 *
 * `optional` is a two-kind fixture rather than the real `cli` manifest so these
 * cases keep working when `artifact-cli` changes, and the real manifest is
 * asserted separately in the section below.
 */
const optional = parse({
  name: 'tool',
  version: '1.0.0',
  entry: '/index.js',
  contracts: [ref('parsing'), ref('pages')],
  kinds: [
    { key: 'parser', version: '1.0.0', provides: [ref('parsing')], ports: [] },
    {
      key: 'pages',
      version: '1.0.0',
      instances: 'explicit',
      provides: [ref('pages')],
      config: { type: 'object', fields: { width: { type: 'number', optional: true } } },
      ports: [port('kv', 'platform:store', 'one')]
    }
  ]
})

test('a kind that opted out gets no instance for merely being in the set', () => {
  // The claim in one line. Nothing signed anything, so nothing holds what the
  // `pages` kind holds — and the sibling kind everybody actually needs is here.
  const specs = plan({ tool: optional })
  same(specs.map((s) => s.id), ['tool.parser'])
})

test('and being named by nobody is not an error, it is an absence', () => {
  // A network that never opts in must boot. Refusing would mean an author could
  // only ship an opt-in kind to networks that had already opted in.
  const consumer = artifact('reader', {
    contracts: [],
    deps: [{ name: 'tool', range: '^1.0.0' }],
    ports: [port('pages', 'pages', 'optional')]
  })
  const specs = plan({ tool: optional, reader: consumer })
  same(specs.map((s) => s.id), ['reader', 'tool.parser'])
  assert.equal('pages' in byId(specs, 'reader').bindings, false,
    'the port name reached a realm for a kind nothing instantiated')
})

test('a signed instance is how one comes to exist, and it is wired as before', () => {
  // The other half. There is no default here for the create to take the place
  // of, and `plan.js` must treat that as the supported case it says it is:
  // config carried through, platform port derived, contract now provided.
  const specs = plan({ tool: optional }, {
    instances: [{ id: 'pages', artifact: 'tool', kind: 'pages', config: { width: 72 }, bindings: {} }]
  })
  same(specs.map((s) => s.id), ['pages', 'tool.parser'])
  same(byId(specs, 'pages').config, { width: 72 })
  same(byId(specs, 'pages').bindings, { kv: '@store:pages' },
    'the platform port is the runtime\'s answer, and no op may name one')
})

test('a consumer binds the signed instance, so opting in restores the wiring', () => {
  const consumer = artifact('reader', {
    contracts: [],
    deps: [{ name: 'tool', range: '^1.0.0' }],
    ports: [port('pages', 'pages', 'one')]
  })
  const specs = plan({ tool: optional, reader: consumer }, {
    instances: [{ id: 'pages', artifact: 'tool', kind: 'pages', config: {}, bindings: {} }]
  })
  assert.equal(byId(specs, 'reader').bindings.pages, 'pages')
})

test('a required port on a kind nobody opted into fails at derivation, naming it', () => {
  // What the opt-out costs a consumer that cannot do without. This is `plan.js`'s
  // existing answer for a contract nothing in the set provides, and it is the
  // right one: fail loudly rather than run without the thing.
  const needy = artifact('reader', {
    contracts: [],
    deps: [{ name: 'tool', range: '^1.0.0' }],
    ports: [port('pages', 'pages', 'one')]
  })
  refuses(() => plan({ tool: optional, reader: needy }),
    /reader\.pages requires pages/, 'a one port was satisfied by a kind nothing instantiated')
})

test('a kind may not both opt out and provide permission', () => {
  // Two declarations that both say "not one per kind" and answer the successor
  // question differently. Honouring either leaves the other in force and unread,
  // and the count at stake is the one nothing else can recompute.
  const opted = parse({
    name: 'permissions',
    version: '1.0.0',
    entry: '/index.js',
    contracts: [ref('permission')],
    kinds: [{
      key: 'permissions',
      version: '1.0.0',
      instances: 'explicit',
      provides: [ref('permission')],
      ports: [port('view', 'platform:network-view', 'one')]
    }]
  })
  refuses(() => plan({ permissions: opted }, { permissions: [{ id: 'send.share', artifact: 'send' }] }),
    /permission\.register/, 'a permission kind opted out of a default it never had')
})

/* ────────────── a range is a claim about shapes, now checked ────────────── */

/**
 * `thing`, declared at whichever versions a case needs. A `null` operation list
 * means the declaration carries no `shape` at all, which is a different claim
 * from carrying an empty one and has to be spellable here.
 *
 * @param {[string, object[] | null][]} versions
 */
const owner = (versions) => parse({
  name: 'lib',
  version: '1.0.0',
  entry: '/index.js',
  deps: [],
  contracts: versions.map(([version, operations]) =>
    operations === null ? { id: 'thing', version } : { id: 'thing', version, shape: { operations } }),
  kinds: [{ key: 'lib', version: '1.0.0', provides: [], ports: [] }]
})

const op = (/** @type {string} */ name, /** @type {object[]} */ params = []) => ({ name, params })

const READ = op('read', [{ name: 'key', type: 'string' }])
const WRITE = op('write', [{ name: 'key', type: 'string' }, { name: 'value', type: 'string' }])

const supplier = (/** @type {string} */ version) => artifact('provider', {
  contracts: [],
  deps: [{ name: 'lib', range: '^1.0.0' }],
  provides: [{ id: 'thing', version }]
})

/** `lib` is the dep that makes the shapes visible; the cases that drop it say so.
 *  `object[]` used to stand for the deps, which said nothing: `artifact()` wants
 *  `{ name, range }`, and one case here passes `[]`. */
const wants = (/** @type {string} */ range, /** @type {{ name: string, range: string }[]} */ deps = [{ name: 'lib', range: '^1.0.0' }]) =>
  artifact('consumer', {
    contracts: [],
    deps,
    ports: [{ name: 'store', contract: 'thing', range, cardinality: 'one' }]
  })

test('a provider whose shape is a valid substitution for the baseline plans cleanly', () => {
  // `2.0.0` adds an operation over `1.0.0` and changes nothing else, which is
  // the case `compatible` is explicitly out of scope for refusing.
  const specs = plan({
    lib: owner([['1.0.0', [READ]], ['2.0.0', [READ, WRITE]]]),
    provider: supplier('2.0.0'),
    consumer: wants('^1.0.0 || ^2.0.0')
  })
  assert.equal(byId(specs, 'consumer').bindings.store, 'provider')
})

test('a provider whose shape is not a substitution is refused, naming both versions', () => {
  try {
    plan({
      lib: owner([['1.0.0', [READ, op('legacy')]], ['2.0.0', [READ]]]),
      provider: supplier('2.0.0'),
      consumer: wants('^1.0.0 || ^2.0.0')
    })
    assert.fail('a provider that dropped an operation the consumer may call was bound anyway')
  } catch (err) {
    threw(err)
    assert.ok(err instanceof PlanError, err.message)
    assert.ok(/consumer\.store/.test(err.message), 'names neither the instance nor the port: ' + err.message)
    assert.ok(/thing@1\.0\.0/.test(err.message), 'does not name the baseline: ' + err.message)
    assert.ok(/thing@2\.0\.0/.test(err.message), 'does not name what the provider provides: ' + err.message)
    assert.ok(/operation legacy was removed/.test(err.message), 'does not say what is wrong: ' + err.message)
  }

  // The other half of `narrows`: the operation survives and a parameter moves
  // under the caller, which breaks just as loudly and is far easier to ship.
  try {
    plan({
      lib: owner([['1.0.0', [READ]], ['2.0.0', [op('read', [{ name: 'key', type: 'number' }])]]]),
      provider: supplier('2.0.0'),
      consumer: wants('^1.0.0 || ^2.0.0')
    })
    assert.fail('a parameter changed type under the caller and the port was bound')
  } catch (err) {
    threw(err)
    assert.ok(/parameter key changed type from string to number/.test(err.message), err.message)
  }
})

test('the baseline is the lowest declared version the range admits, not the highest', () => {
  // The rule, not the plumbing. `1.1.0` and `1.2.0` both dropped `legacy` and
  // `1.0.0` has it, so a provider on `1.1.0` is a clean substitution for `1.2.0`
  // and a broken one for `1.0.0` — and `^1.0.0` admits all three. Checking
  // against the highest, or against the provider's own version, passes here.
  //
  // Declared out of numeric order deliberately: taking `contracts[0]` would give
  // the same wrong answer that taking the highest does, and would be a bug this
  // suite could not see if the fixture happened to be sorted.
  const lib = owner([['1.2.0', [READ]], ['1.0.0', [READ, op('legacy')]], ['1.1.0', [READ]]])

  try {
    plan({ lib, provider: supplier('1.1.0'), consumer: wants('^1.0.0') })
    assert.fail('a range reaching back to 1.0.0 was checked against something later than 1.0.0')
  } catch (err) {
    threw(err)
    assert.ok(err instanceof PlanError, err.message)
    assert.ok(/thing@1\.0\.0/.test(err.message), 'the baseline was not the lowest satisfying version: ' + err.message)
    assert.ok(/operation legacy was removed/.test(err.message), err.message)
  }

  // Same set, same provider, one narrower range. `^1.1.0` no longer admits
  // `1.0.0`, so the consumer never promised to work against a shape with
  // `legacy` in it and the identical wiring is correct.
  const specs = plan({ lib, provider: supplier('1.1.0'), consumer: wants('^1.1.0') })
  assert.equal(byId(specs, 'consumer').bindings.store, 'provider')
})

test('an unshaped contract on either side is unchecked and still plans', () => {
  // An unshaped contract is the migration path. Refusing here would mean adding
  // a shape to one manifest breaks every network that has not added one to the
  // rest, which is how a check gets reverted rather than adopted.
  const noBaseline = plan({
    lib: owner([['1.0.0', null], ['2.0.0', [READ]]]),
    provider: supplier('2.0.0'),
    consumer: wants('^1.0.0 || ^2.0.0')
  })
  assert.equal(byId(noBaseline, 'consumer').bindings.store, 'provider')

  const noProvider = plan({
    lib: owner([['1.0.0', [READ, op('legacy')]], ['2.0.0', null]]),
    provider: supplier('2.0.0'),
    consumer: wants('^1.0.0 || ^2.0.0')
  })
  assert.equal(byId(noProvider, 'consumer').bindings.store, 'provider')
})

test('a declaration the consumer cannot reach through its own deps is not consulted', () => {
  // `lib` is in the loaded set and declares both shapes. The consumer names
  // `provider` as its dep and not `lib`, so those declarations are not part of
  // the vocabulary it was built against and the planner does not hold it to one
  // it never saw. Scanning every manifest instead would make the baseline
  // depend on who else the network happens to run.
  const set = {
    lib: owner([['1.0.0', [READ, op('legacy')]], ['2.0.0', [READ]]]),
    provider: supplier('2.0.0'),
    consumer: wants('^1.0.0 || ^2.0.0', [{ name: 'provider', range: '^1.0.0' }])
  }
  assert.equal(byId(plan(set), 'consumer').bindings.store, 'provider')

  // One dep entry apart. Naming `lib` is what makes the shapes visible, and the
  // otherwise identical graph is then refused.
  refuses(() => plan({ ...set, consumer: wants('^1.0.0 || ^2.0.0') }),
    /operation legacy was removed/, 'the shapes stayed invisible to a consumer that named their owner')
})

/* ──────────────── a port that says which family it wants ────────────────── */

/**
 * `renderer@2` in miniature: one artifact declaring a family-determined
 * contract, and any number providing it in whatever family they say.
 *
 * Synthetic rather than the shipped stack, and that is forced rather than
 * preferred. The real set cannot express the question yet — `macos.renderer` and
 * `ui.shell`'s `renderer` port are both `one` and neither names a family, so
 * putting a second renderer beside `artifact-ui` makes *those two* ambiguous
 * whatever the port under test asks for. That is not a flaw in the fixture; it
 * is the migration this field opens, and until the shipped ports name their
 * families the shipped set has exactly the ambiguity the case above pins.
 */
const paintDecl = () => parse({
  name: 'decl',
  version: '1.0.0',
  entry: '/index.js',
  deps: [],
  contracts: [{
    id: 'paint',
    version: '1.0.0',
    shape: {
      // `draw` declares no `returns` of its own: an operation's type is the
      // contract's or the family's and never both.
      family: { selector: 'family', returns: ['draw'] },
      operations: [
        { name: 'family', returns: { type: 'string' } },
        { name: 'draw' }
      ]
    }
  }],
  kinds: []
})

/** @param {string} name @param {string} tag @param {string} type */
const painter = (name, tag, type) => parse({
  name,
  version: '1.0.0',
  entry: '/index.js',
  deps: [{ name: 'decl', range: '^1.0.0' }],
  contracts: [],
  kinds: [{
    key: 'p',
    version: '1.0.0',
    provides: [{ id: 'paint', version: '1.0.0', family: { tag, returns: { draw: { type } } } }],
    ports: []
  }]
})

/** @param {string} [family] the tag to ask for, or nothing to ask for none */
const viewer = (family) => parse({
  name: 'viewer',
  version: '1.0.0',
  entry: '/index.js',
  deps: [{ name: 'decl', range: '^1.0.0' }],
  contracts: [],
  kinds: [{
    key: 'v',
    version: '1.0.0',
    provides: [],
    ports: [{
      name: 'canvas',
      contract: 'paint',
      range: '^1.0.0',
      cardinality: 'one',
      ...(family === undefined ? {} : { family })
    }]
  }]
})

/** Both families in one set, which is the arrangement that used to refuse. */
const both = () => ({
  decl: paintDecl(),
  text: painter('text', 'text@1', 'string'),
  doc: painter('doc', 'document@1', 'object')
})

test('a port asking for a family gets the one provider in it, out of two', () => {
  // The case the ambiguity error was firing on. Two providers of one contract
  // in one set is exactly what the previous case refuses — and it is not
  // actually ambiguous, because the two differ in a field both manifests have
  // carried since families landed. Until `ports[].family` existed the resolver
  // was not allowed to read it.
  assert.equal(byId(plan({ ...both(), viewer: viewer('text@1') }), 'viewer').bindings.canvas, 'text')

  // And the other way round, so this is a filter and not a preference for
  // whichever provider sorts first — `doc` precedes `text`.
  assert.equal(byId(plan({ ...both(), viewer: viewer('document@1') }), 'viewer').bindings.canvas, 'doc')
})

test('a port asking for a family nobody provides is refused, naming both ends', () => {
  // `widget@1` is a family this network has no provider for. The old message
  // could only say the contract was missing, which is false here and sends an
  // admin looking for an artifact that is already installed. Both ends: the
  // port that asked, and what is actually on offer instead.
  try {
    plan({ ...both(), viewer: viewer('widget@1') })
    assert.fail('a port was handed a provider from a family it did not ask for')
  } catch (err) {
    threw(err)
    assert.ok(/viewer\.canvas/.test(err.message), err.message)
    assert.ok(/widget@1/.test(err.message), err.message)
    assert.ok(/text@1/.test(err.message) && /document@1/.test(err.message), err.message)
    assert.ok(/doc, text/.test(err.message), err.message)
    // And it does not claim the contract is absent, which is the wrong repair.
    assert.ok(!/nothing provides the contract at all/.test(err.message), err.message)
  }
})

test('a family filter on a contract nothing provides says so, rather than blaming the family', () => {
  try {
    plan({ decl: paintDecl(), viewer: viewer('text@1') })
    assert.fail('a port with no provider at all resolved')
  } catch (err) {
    threw(err)
    assert.ok(/nothing provides the contract at all/.test(err.message), err.message)
  }
})

test('a port that names no family still takes any provider, so old manifests are unchanged', () => {
  // Absence means "did not ask", never "wants a provider that also said
  // nothing". Narrowing silently would make every manifest written before the
  // field a different port than its author wrote.
  const one = { decl: paintDecl(), text: painter('text', 'text@1', 'string'), viewer: viewer() }
  assert.equal(byId(plan(one), 'viewer').bindings.canvas, 'text')

  // With two in the set it is ambiguous again, which is the rule the filter
  // narrows the candidates for rather than replaces.
  try {
    plan({ ...both(), viewer: viewer() })
    assert.fail('an unfiltered port picked one of two providers')
  } catch (err) {
    threw(err)
    assert.ok(/viewer\.canvas/.test(err.message), err.message)
    assert.ok(/doc, text/.test(err.message), err.message)
  }
})

test('two providers in one family are still ambiguous, because the filter is not a pick', () => {
  // The rule the family filter must not weaken. Narrowing to a family leaves
  // whatever is in that family, and two of those is the same error it always
  // was — sort order still decides nothing.
  const set = { ...both(), text2: painter('text2', 'text@1', 'string'), viewer: viewer('text@1') }
  try {
    plan(set)
    assert.fail('two providers of one family resolved to one')
  } catch (err) {
    threw(err)
    assert.ok(/viewer\.canvas/.test(err.message), err.message)
    assert.ok(/text, text2/.test(err.message), err.message)
  }
})

/* ─────────────────────────────── run them ───────────────────────────────── */

t.plan(cases.length)
for (const [name, fn] of cases) {
  try { fn(); t.pass(name) } catch (err) { t.fail(`${name} — ${err instanceof Error ? err.message : err}`) }
}
