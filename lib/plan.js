/**
 * From "what should I run" to "how is it wired", with nothing local in between.
 *
 * The network's signed state answers the first question: an artifact set, and
 * for each one the version ranges asked of it (`artifact-net`'s view). It does
 * not answer the second. Something has to decide that `macos`'s `parser`
 * port points at the `cli` artifact's parser kind, and until now that something
 * was a `plan.json` file on the device — which meant the device owner was, in
 * the end, the authority on what their machine ran.
 *
 * This module is that decision, made by derivation instead. It is a **pure
 * function**: signed state and fetched manifests in, an instance graph out. No
 * filesystem, no clock, no iteration-order dependence, sorted output. Two
 * devices given the same view derive the same graph or the code is wrong.
 *
 * ## Ports resolve against the network's set, and only that
 *
 * A manifest's `deps` is *not* an install instruction, and treating it as one
 * would be a hole: an author could add code to every device running their
 * artifact by editing one line of their own manifest, with no admin involved.
 * So the transitive closure is deliberately **not** walked. `deps` states which
 * contracts an artifact is built to talk to; the network's artifact set states
 * what is actually present; a port finds a provider or it does not.
 *
 * ## A range is a claim about shapes, and it is now checked
 *
 * `semver.satisfies` compares two numbers a human typed. Until this paragraph
 * that was the whole of it: an author who bumped a contract to `2.0.0` while
 * deleting an operation from its shape, and a consumer whose port reads
 * `^1.0.0 || ^2.0.0`, planned cleanly and failed at the call. The shape was
 * already in the manifest — hashed, covered by the release signature, pinned —
 * and nothing read it.
 *
 * `contract.compatible` now runs on every port this planner derives, and what
 * that makes true is narrow enough to state exactly: **a derived binding has had
 * the provider's declared shape checked as a structural substitution for the
 * weakest shape the port's own range commits its consumer to.** An author can
 * still ship a breaking change. They can no longer ship one their own two
 * declarations already contradict and have a device wire it up regardless.
 *
 * ### The baseline is the *lowest* declared version the range admits
 *
 * A port saying `^1.0.0` is its author promising to cope with anything from
 * `1.0.0` up, so `1.0.0`'s shape is all that author may rely on and the only
 * honest thing to hold a provider to. Both alternatives dissolve the check:
 *
 *   - the *newest* satisfying declaration lets a contract's owner widen the
 *     shape in `1.2.0` and thereby bless providers against a promise half the
 *     consumers on the network never made;
 *   - the *provider's own* version is vacuous. `compatible(s, s)` is `ok` by
 *     construction, so that check passes for every provider, always.
 *
 * ### Which declarations count is the `deps` rule again
 *
 * The versions of a contract in play are those visible through the consumer's
 * own manifest plus the artifacts it named in `deps` — never every manifest in
 * the set. Scanning the set would make the baseline depend on who else the
 * network happens to run: add an artifact declaring `C@0.9.0` and every consumer
 * of `C` is abruptly held to a shape its author never saw. That is the argument
 * above from the other side. `deps` states what an artifact was built to talk
 * to, and it is therefore also the vocabulary it may be judged against.
 *
 * Every absence is unchecked rather than refused — no visible declaration, no
 * `shape` on the baseline, no `shape` on the provider's version. An unshaped
 * contract is the migration path, most of the shipped set is still on it, and
 * inventing a failure there would mean adding a shape to one manifest breaks
 * every network that has not yet added one to the rest. A provider whose
 * declaring artifact is missing from the loaded set is likewise left alone here,
 * deliberately: `assemble.js` owns that error, and one condition with two
 * different errors is worse than the condition.
 *
 * ### What it does not decide, and where it does not run
 *
 * Nothing about behaviour. `compatible`'s own header carries that argument and
 * it is the load-bearing one: two declarations agreeing is not two
 * implementations agreeing, and an operation that quietly began returning cents
 * passes this check untouched.
 *
 * It also does not run on an *explicit* binding. A signed instance naming a
 * target by id never reaches `resolve`, which is consistent with everything else
 * about explicit bindings — the admin's word wins over derivation — but it means
 * the guarantee above is about the graph this module derives, not about every
 * edge in the graph it returns.
 *
 * ## Absence as configuration
 *
 * That is also what makes the isolation requirement land as a *configuration*
 * rather than a promise. `send` declares an optional `qr` port. On a network
 * whose set includes `qr`, it is bound. On a network whose set does not, the
 * port is never passed inward and `send` has no name for it — not denied,
 * absent. Which of those a device gets is an admin's signed decision.
 *
 * ## Cardinality decides what "no provider" means
 *
 *   - `one`      — required. Nothing provides it, and that is a failure worth
 *                  naming, because the artifact cannot run without it.
 *   - `optional` — left unbound. The realm never learns the port name, which is
 *                  the same absence an artifact sees on a network that does not
 *                  have the thing at all.
 *   - `many`     — bound to the list, *including when the list is empty*. An
 *                  artifact declaring a many port has to handle zero targets
 *                  anyway, and leaving it unbound instead would take away the
 *                  `count()` it uses to find that out.
 *
 * Two providers for a `one` or `optional` port is an error rather than a pick.
 * Choosing would make the answer depend on sort order, and sort order is not a
 * thing an admin decided.
 *
 * ## A port may ask for a renderer family, and that is how two of them coexist
 *
 * `ports[].family` is the fourth filter, beside contract, range and cardinality,
 * and `resolve` below has the argument. The short form: a contract whose shape
 * leaves some return types to the *family* — `renderer@2` — has providers that
 * satisfy its id and its range and still answer in types one consumer cannot
 * both handle. Before the filter existed, two renderers in one set were two
 * providers of one `one` port and this function refused to derive, naming both;
 * the paragraph above about ambiguity was firing on a question that was not
 * actually ambiguous, because the fact that separates them was in the signed
 * manifest and nothing could read it.
 *
 * It does not weaken the ambiguity rule, and it is worth being clear about which
 * of the two is doing the work. Two providers of one contract *in one family* is
 * still an error naming both — the filter narrows the candidate set and the same
 * rule then applies to what is left. What it removes is only the case where the
 * answer was already determined and the resolver was not allowed to see it.
 *
 * ## One instance per kind — and one per registered permission
 *
 * Every kind in every fetched artifact becomes one instance, unless the view
 * names instances of that kind, in which case those are what exist and the
 * default is not declared at all — see below. The other exception is the
 * `permission` contract, where the count comes from the view: one instance
 * per `permission.register` in the network's log, configured with that
 * permission's id. That is the model you asked for — a permission *is* an
 * instance — and it is the second half of the bootstrap exception `native.js`
 * describes, for the same reason: how many permission instances exist is a
 * wiring decision, and the only non-local source for it is the signed view.
 *
 * A permission port resolves only against permissions **registered by the
 * artifact that declares the port**, so `send`'s `canShare` cannot be handed
 * some other artifact's permission instance. An artifact registering two
 * permissions disambiguates by naming the port after the permission's local id
 * — `send.share` fills a port called `share` — because nothing else in the
 * manifest says which gate a port is.
 *
 * ### And none at all, for a kind that asked for none
 *
 * A kind may declare `instances: "explicit"`
 * (`artifact-protocol/lib/manifest.js`), and then this function declares nothing
 * for it. It exists on the device — fetched, verified, hashed into a release with
 * the rest of its artifact — and runs only where a signed `instance.create` names
 * it. That is the same replacement path a configured `send` takes, with the
 * default it replaces missing rather than present.
 *
 * This is a *generalisation of the permission case above*, not a new mechanism.
 * The paragraph above already says a kind whose instances are not defaulted is a
 * thing this loop understands; what the field adds is that the kind gets to say
 * so, instead of the planner recognising a contract id. The two cannot be
 * combined, and a kind that declares both is refused by name: one says the count
 * comes from the log and the other says it comes from a create, and whichever
 * this file honoured would leave the other in force and unread.
 *
 * **Why a kind would want it.** Because being in a network's artifact set is the
 * wrong reason to hold a capability. `artifact-cli`'s `docs` kind binds
 * `platform:documentation`, which `native.js` states is `platform:manifests`
 * behind a table renderer, and it ships alongside `cli-parser` — the kind every
 * adapter on every network needs. Defaulting both meant every network with a
 * command line ran something that could reconstruct its artifact set. The
 * capability was declared and admitted, so nothing was breached; it simply
 * arrived without anybody choosing it, and a capability that widens what a device
 * can learn about its own graph should be chosen.
 *
 * **What it costs**, because it is not free: pages now need an op. `artifact docs
 * <contract>` worked on any network with a command line and now works on one
 * whose admin signed an `instance.create` naming `cli.docs`. That is a deployment
 * step and a signature, for a capability that used to be a side effect of wanting
 * a parser. It is the trade this file makes everywhere — the more of the graph an
 * admin enumerates, the less of it is derived — spent here on the one axis where
 * derivation was granting rather than wiring.
 *
 * **A kind that opted out and is never named is not an error.** Refusing would
 * mean an author could only ship an opt-in kind to networks that had already
 * opted in. A `one` port aimed at the contract such a kind provides fails at
 * derivation naming the port, which is this file's existing answer for a contract
 * nothing in the set provides — correctly, since an artifact that cannot run
 * without pages should say so rather than run without them.
 *
 * ## Instances the network signed for
 *
 * `artifact-net`'s `instance.create` names an instance outright — its id, its
 * artifact, its kind, its config and its bindings — and `view.instances` carries
 * those here. They **replace** the default instance for the artifact and kind
 * they name: if the view says anything at all about `send`'s `send` kind, the
 * default `send` is not declared and the signed ones are what exists. Where the
 * kind declared `instances: "explicit"` there is no default to replace, and the
 * same path serves — it is a supported case rather than a coincidence, and the
 * tests hold it that way.
 *
 * Purely additive was the alternative and it is wrong for a concrete reason. An
 * admin who signs two configured `send`s wants two `send`s; adding them beside
 * the default gives three, one of which nobody asked for, and all three then
 * contend for every `one` port aimed at a contract they provide — so the first
 * thing an admin would get by asking for two instances is a graph that refuses
 * to plan. Replacement also keeps the op's *absence* meaning what it always
 * meant: a network that signs nothing derives exactly the graph it derived
 * before this existed.
 *
 * Per artifact **and kind**, never per artifact. An artifact's kinds are
 * separate programs, and configuring one says nothing about the others.
 *
 * A signed instance may not name a kind that provides `permission`. How many
 * permission instances exist is answered by `permission.register`, and letting a
 * create replace that set would let one op quietly delete a network's gates.
 *
 * ## A signed instance says what it may reach, and it says all of it
 *
 * An explicit binding is never overwritten — an admin who names a target gets
 * that target. What an *unnamed* port falls back to is decided by cardinality,
 * and the split is the substance of the feature:
 *
 *   - `platform:*` is always derived, and an op may not bind one at all. The
 *     runtime fills these and their targets are not instance ids (`@network-view`,
 *     `@store:x`), which the `id` field kind could not spell if it wanted to.
 *   - `one` is derived, because it has no absent state to express. Unbound is an
 *     error, so silence there could only ever mean "fail" — and making an admin
 *     enumerate the required wiring by hand is `plan.json` returning with a
 *     signature on it, which is the file this module exists to delete.
 *   - `optional` and `many` are **exactly what the admin wrote**, and the admin
 *     has to write all of them. Bindings are *total* over these discretionary
 *     ports: one the kind declares and the op omits is a `PlanError` naming it.
 *     Deliberate emptiness is spelled — `null` for an `optional` port, `[]` for
 *     a `many` one.
 *
 * That third rule is the whole reason the op is worth having. Deriving optional
 * ports for a signed instance would bind `qr` to *every* `send` on a network
 * whose set includes `qr`, and the `send` with `qr` beside the `send` without it
 * — the case this header has promised since it was written — would still be
 * inexpressible. In one line: **derivation supplies what an instance cannot run
 * without, and the admin supplies what it may reach.**
 *
 * ### Why totality, when silence was already an answer
 *
 * Silence *was* an answer here, and the paragraph this one replaces called that
 * a real footgun: creating a signed instance takes over every discretionary port
 * on it, including ones the default would have filled, and a forgotten port was
 * a capability quietly missing rather than an error. What made it worse than the
 * absences elsewhere in this file is that it was not distinguishable from one.
 * Everywhere else, absent means the network's set does not have the thing, and
 * an admin can go and look. Here, `{}` was both "this send deliberately gets no
 * qr" and "whoever wrote this op forgot qr", written identically, signed
 * identically, and folding to identical state. No amount of reading the log
 * tells the two apart, and the artifact cannot tell either — that is the whole
 * design of §3, and it is why the missing capability surfaces as a feature
 * mysteriously not working rather than as anything anybody can grep for.
 *
 * So the vocabulary is widened instead: `artifact-net`'s `bindings` field kind
 * now admits `null` as a target, and omission stops being a spelling of
 * anything. An admin still gets both outcomes; they just have to have meant it.
 *
 * The alternatives, and why they lose:
 *
 *   - *Derive the unnamed discretionary ports.* This is the feature, deleted.
 *     Both sends get `qr`, and per-instance differentiation is gone.
 *   - *Warn instead of refusing.* There is no channel. `plan()` is a pure
 *     function on two devices that have to agree, and a warning nobody reads is
 *     the silence this rule exists to end.
 *   - *Make it total over `one` ports too.* Deliberately not, and the exclusion
 *     is not laziness. A `one` port has no empty state — unbound is already an
 *     error — so silence there cannot hide a capability; it can only hide a
 *     failure that this module raises anyway, by name, at plan time. Demanding
 *     it would buy nothing and cost the thing the `one` bullet above argues for:
 *     an admin hand-enumerating required wiring is `plan.json` with a signature
 *     on it.
 *
 * The cost that remains is real but small and, unlike the old one, loud: adding
 * a discretionary port to a kind invalidates every signed instance of it until
 * an admin re-signs. A create's terms are fixed (`instance.remove` plus a new
 * id), so that is a deployment step, not an edit. It is the same bargain the
 * rest of this file makes — the more of the graph an admin enumerates, the less
 * of it is derived — except that here the enumeration is checked.
 *
 * ## The fold cannot check any of this, so this file must
 *
 * `artifact-net`'s reducer has no manifests. It cannot know whether `send` is in
 * this network's artifact set, whether `send` has a kind called `send`, or
 * whether a binding points at an instance that exists, so a create getting any
 * of that wrong folds into state without complaint and fails here as a
 * `PlanError`. That is not a gap in the fold: a fold that fetched manifests
 * would not be a fold.
 *
 * ## `lifetime` is not consulted, because it was removed
 *
 * A kind used to declare `singleton | scoped | transient` and this planner
 * ignored it. It is now gone from the manifest schema rather than implemented,
 * and this is the file the argument belongs in, because this file is where the
 * instance count is decided.
 *
 * None of the three had a meaning to be given here. There is no *resolution*
 * event for `transient` to happen at: the graph is derived once, every instance
 * is built before any code runs, and `route()` resolves a port name to a fixed
 * id. Making it real would mean constructing a realm per dependency call —
 * re-evaluating the bundle and re-running `build` — which destroys the one thing
 * `build` is for, since everything an artifact remembers lives in that closure.
 * `scoped` needs a scope, and the only scope in the system is the network, which
 * already gets a graph of its own from `boot.js`. `singleton` is what the line
 * below already does, unconditionally, for every kind.
 *
 * The decisive objection is not that it was meaningless, though. It is **whose
 * field it was.** The question a lifetime answers is whether two consumers share
 * one provider instance — whether `send` and `cli` are handed the same renderer,
 * and therefore whether those two artifacts have a mutable object in common.
 * That is a wiring decision about somebody else's artifacts, and it was declared
 * in a document the *provider's* author signs. Everything else in this file
 * refuses exactly that: `deps` is not walked because an author must not be able
 * to add code to a device by editing their own manifest, and the permission
 * count comes from the signed view because how many instances exist is a wiring
 * decision. A lifetime field is the same thing wearing a dependency-injection
 * name, and implementing it faithfully would have been a regression.
 *
 * ## What differentiation costs, now that it is possible
 *
 * The paragraph that stood here said `instance.create` did not exist and that
 * differentiation was therefore per network rather than per instance. Both
 * halves are now false, and what survives them is the consequence, which is
 * still exactly true of the default graph:
 *
 * **One instance per kind means a provider bound by two consumers is one object
 * serving both**, so any state it keeps is a two-way channel between artifacts
 * that §3 otherwise keeps strangers. It is not a hole in the realm boundary —
 * neither consumer can name the other, and neither learns anything the provider
 * does not choose to tell them — but it is a channel, and the party entitled to
 * close it is the network, by asking for two instances. The network can now do
 * exactly that.
 *
 * What that costs is worth writing down, because "possible" is not "free".
 * Splitting a shared provider means signing an `instance.create` for each half
 * and then signing a binding on **every consumer that should get the second
 * one** — because a consumer's unnamed `one` port still resolves against the
 * network's set, and that set now has two providers of one contract, which is an
 * ambiguity error rather than a pick. So the split is not one op: it is one per
 * instance plus one per consumer, and a consumer left out halfway through is a
 * network that will not plan. The channel closes by the network enumerating the
 * graph, and the more of the graph an admin enumerates the less of it is
 * derived. That is the trade this module was built to avoid, now available
 * deliberately, per instance, to the only party entitled to make it.
 *
 * ## What is still not derived
 *
 * The paragraph that stood here said instances were network-wide while artifact
 * sets were per group, and that an instance naming an artifact only some groups
 * receive therefore failed the boot of every device outside them. That is fixed
 * and the fix is not in this file: `instance.create` names a group, and
 * `artifact-net`'s `assemblyFor` filters on it before a view ever reaches this
 * function. An instance deployed to Staff is *absent* on a machine outside
 * Staff, which is the answer that file already gave for an artifact. Nothing
 * here can watch that happen, and that is the right arrangement — which groups
 * a user is in is signed state, and this module is handed the answer rather
 * than asked for it.
 *
 * What is genuinely still not derived is the grain below that: **which device
 * inside a group gets which instance.** Two machines belonging to one user in
 * one group derive the same graph, so "this laptop gets the configured `send`
 * and that one does not" remains inexpressible. The only axis the vocabulary
 * offers is who you are, not which machine you are sitting at, and that is
 * deliberate rather than pending: a device is a credential for a user, not a
 * subject in its own right, and an op naming a device key would make a
 * network's wiring depend on hardware an admin has to enumerate and re-enumerate
 * by hand. If that ever changes it changes in the op vocabulary; this planner
 * would need no edit to serve either answer, because it already takes the
 * instance set as given.
 *
 * One error belongs to neither the fold nor this file: an instance in a group
 * of an artifact that group does not deliver. `assemblyFor` throws it, because
 * that is the one place where both facts — what a group runs and what it was
 * sent — are in hand at once, and by the time a view arrives here the
 * contradiction has already been reported by name.
 *
 * ## Where this lives
 *
 * This file was `ArtifactPatform/lib/plan.js` and is now
 * [`artifact-planner`](https://github.com/AustinPoonia/artifact-planner)'s,
 * beside `chain.js`, which it imports three shared rules from. `index.js` there
 * has the argument for the move and for why the two could not be separated. The
 * kernel keeps a one-line re-export at the old path, so `boot.js` still spells
 * this `./plan` and `artifact-operator` still reaches it through the subpath it
 * always did. `chain.js`'s header carries the note about what an unprefixed
 * filename in these two files means.
 */
const { version: semver, manifest: { INSTANCING, PERMISSION_CONTRACT } } = require('artifact-protocol')
const { NATIVE, visible, substitution } = require('./chain')

/**
 * The one artifact-level contract the planner knows by name. See the header.
 *
 * Read from `artifact-protocol` rather than spelled here, which it was for three
 * rounds of cleanup. The id belongs beside the vocabulary it implements: a
 * manifest's `permissions` block is defined by `artifact-protocol/lib/manifest.js`
 * and `permission@1` is the contract that stands behind that block, so the two
 * facts are one fact and two files were keeping it.
 *
 * Not a literal-plus-guard, which is what `EXPLICIT` below and `boot.js`'s
 * `CLI_SURFACE` are. Those two are compared against a *closed set*, so they need a
 * literal a reader can see at the comparison and a check that the set still
 * admits it. This is a single value with no set to be a member of, so importing it
 * is strictly better than restating it: there is no second copy to drift, and the
 * value is validated where it is defined — a `permission` that stopped being a
 * legal contract id, or started colliding with `platform:` or `kernel:`, fails the
 * import of that module rather than becoming a rule here that matches nothing.
 *
 * It is deliberately **not** in the `kernel:` namespace, and the temptation to put
 * it there is worth naming because the two hardcodings looked alike. A `kernel:`
 * contract is one the *kernel calls*; nothing in this file or in `boot.js` invokes
 * a single operation on a permission instance. What this file does is key a
 * resolution rule on the id — how many instances a permission kind gets, and which
 * of them a port may see — and a rule about resolution is not a claim about who is
 * on either end of a call. Its consumers are artifacts: `artifact-send`'s
 * `canShare` port is a real wire from one artifact to another, and a prefix saying
 * the platform consumed it would be a false statement about that wire.
 */
const PERMISSION = PERMISSION_CONTRACT

/**
 * The instancing policy this planner honours. Spelled here because a comparison
 * needs a literal, and immediately checked against the protocol's own set for
 * the reason `boot.js` checks `CLI_SURFACE`: a word the parser stopped admitting
 * is a policy no manifest can declare any more, and this file would then default
 * every kind and say nothing. The alternative — `INSTANCING[0]` — is an index
 * rather than a claim, and would keep comparing cleanly against whatever value
 * happened to be first.
 */
const EXPLICIT = 'explicit'
if (!INSTANCING.includes(EXPLICIT)) {
  throw new Error(
    `this planner honours the "${EXPLICIT}" instancing policy, which artifact-protocol no longer admits ` +
    `(${INSTANCING.join(', ')})`
  )
}

class PlanError extends Error {
  /** @param {string} message */
  constructor (message) {
    super(message)
    this.name = 'PlanError'
  }
}

/**
 * One contract declaration, as `manifest.contracts[i]` holds it.
 *
 * @typedef {object} Declaration
 * @property {string} version
 * @property {import('artifact-protocol/contract').Shape} [shape]
 */

/**
 * @typedef {object} Registered
 * @property {string} id         the permission id, as registered
 * @property {string} artifact   the artifact that registered it
 */

/**
 * What `plan()` returns: an `InstanceSpec` whose `bindings` is *present*.
 *
 * `InstanceSpec.bindings` is optional because a hand-written spec — the shape
 * `assemble()` takes from a test or from `native.js` — may legitimately omit it
 * and mean "no ports". A derived one never does: the loop below starts from
 * `const bindings = {}` and hands it over whether or not a port went into it,
 * because "bound to nothing" and "has no bindings key" are different facts
 * downstream and only the first is what a planned instance can be.
 *
 * Saying so here rather than `InstanceSpec[]` is not decoration. Callers that
 * read `spec.bindings.someport` back — the planner's own suite does it in a
 * dozen places, and `chain.js` walks it — were otherwise obliged to re-check an
 * invariant this function guarantees, and the honest ways to do that (`?.`, a
 * cast) both make a real absence look survivable when it would be a bug here.
 *
 * `InstanceSpec` comes from `./chain`, which is where it is declared — see the
 * typedef there for why the producing side owns it rather than `assemble.js`,
 * which used to.
 *
 * @typedef {import('./chain').InstanceSpec & { bindings: Record<string, string | string[]> }} Planned
 */

/**
 * One `instance.create` that survived the fold, as `artifact-net` holds it.
 *
 * @typedef {object} Signed
 * @property {string} id
 * @property {string} artifact
 * @property {string} kind
 * @property {Record<string, unknown>} config
 * @property {Record<string, string | string[] | null>} bindings   `null` is a port left deliberately unbound
 */

/**
 * Derive the instance graph.
 *
 * @param {Record<string, import('artifact-protocol/manifest').Manifest>} manifests
 *        every artifact the network's set resolved to, by name
 * @param {object} [view]
 * @param {readonly Registered[]} [view.permissions]   registered permissions, from the signed log
 * @param {readonly Signed[]} [view.instances]         instances the network signed for
 * @returns {Planned[]}
 */
function plan (manifests, view = {}) {
  const permissions = [...(view.permissions ?? [])].sort((a, b) => cmp(a.id, b.id))
  const signed = [...(view.instances ?? [])].sort((a, b) => cmp(a.id, b.id))

  /** Every instance that will exist, before anything is bound. */
  const instances = declare(manifests, permissions, signed)

  // Once, not per port. Every manifest is already in hand and the visible set
  // is a property of the consuming artifact, not of the port being resolved.
  const declared = visible(manifests)

  // Targets are checked once the whole set is known, because a signed instance
  // may legitimately bind another signed instance that is declared after it.
  const ids = new Set(instances.map((i) => i.id))
  for (const instance of instances) {
    for (const [port, target] of Object.entries(instance.bindings ?? {})) {
      if (target === null) continue // deliberately unbound; there is no target to find
      for (const t of Array.isArray(target) ? target : [target]) {
        if (!ids.has(t)) {
          throw new PlanError(`${instance.id}.${port} is bound to ${t}, which is not an instance in this graph`)
        }
      }
    }
  }

  // Providers, indexed once. A contract is provided by an instance, not by an
  // artifact — two kinds of one artifact provide different things.
  //
  // `family` is carried because a port may now filter on it, and it is flattened
  // to the tag here rather than passed whole: a provider *publishes* a family —
  // the tag plus a return schema per operation the contract left open — and the
  // only part of that a resolver compares is the tag. The schemas are somebody
  // else's business, checked by `chain.js` statically and at the call boundary by
  // `assemble.js`, and carrying them through here would invite this file to have
  // an opinion about them.
  /** @type {Map<string, { id: string, version: string, artifact: string, family?: string }[]>} */
  const providers = new Map()
  for (const instance of instances) {
    for (const provided of instance.kind.provides) {
      const list = providers.get(provided.id) ?? []
      list.push({
        id: instance.id,
        version: provided.version,
        artifact: instance.artifact,
        family: provided.family?.tag
      })
      providers.set(provided.id, list)
    }
  }

  return instances.map((instance) => {
    /** @type {Record<string, string | string[]>} */
    const bindings = {}
    const explicit = instance.bindings ?? null

    for (const port of instance.kind.ports) {
      const native = NATIVE[port.contract]
      if (native) {
        bindings[port.name] = native({ artifact: instance.artifact, instance: instance.id })
        continue
      }

      if (port.contract.startsWith('platform:')) {
        throw new PlanError(
          `${instance.id}.${port.name} requires ${port.contract}, which this runtime does not provide`
        )
      }

      // `hasOwnProperty` and not `in`, because a port may be called
      // `constructor` and every plain object already has one of those.
      if (explicit !== null && Object.prototype.hasOwnProperty.call(explicit, port.name)) {
        const target = explicit[port.name]
        // A `null` target resolves to no key at all. `assemble.js` reads a port
        // as bound if its name is present, so passing the null on would hand the
        // realm a name for a capability the admin said it does not have — the
        // opposite of what was signed, spelled the way it was signed.
        if (target !== null) bindings[port.name] = target
        continue
      }

      // Anything reaching here is derived, and for a signed instance that can
      // only be a `one` port: `declare` already refused the omission of any
      // other. See the header for why required wiring stays derived.

      const found = resolve(instance, port, providers, permissions, declared)

      if (port.cardinality === 'many') {
        bindings[port.name] = found.map((f) => f.id).sort(cmp)
        continue
      }

      if (found.length > 1) {
        const names = found.map((f) => f.id).sort(cmp).join(', ')
        throw new PlanError(port.contract === PERMISSION
          ? `${instance.id}.${port.name} could be any of ${names}; name the port after the permission it gates ` +
            `(a port called "share" takes ${instance.artifact}.share) so the binding is the author's decision and not sort order`
          : `${instance.id}.${port.name} wants one ${port.contract} and ${found.length} instances provide it ` +
            `(${names}); the network set is ambiguous`)
      }

      if (found.length === 0) {
        if (port.cardinality === 'one') {
          // Both ends named. A port that asked for a family and got nothing has
          // two possible causes that read identically in the old message — the
          // contract is absent from the set, or it is present in the wrong
          // family — and the second is the one an admin can actually fix, by
          // signing in the artifact that provides the family they wanted. So the
          // families that *are* on offer are listed, from the same index the
          // filter just rejected them with.
          if (port.family !== undefined) {
            const offered = (providers.get(port.contract) ?? [])
              .filter((p) => p.id !== instance.id && semver.satisfies(p.version, port.range))
            const tags = [...new Set(offered.map((p) => p.family ?? '(none declared)'))].sort(cmp)
            throw new PlanError(
              `${instance.id}.${port.name} requires ${port.contract} ${port.range} in family ` +
              `${JSON.stringify(port.family)}, and nothing in this network's artifact set provides that family` +
              (offered.length === 0
                ? '; nothing provides the contract at all'
                : ` (${offered.map((p) => p.id).sort(cmp).join(', ')} provide${offered.length === 1 ? 's' : ''} it in ` +
                  `${tags.join(', ')})`)
            )
          }
          throw new PlanError(
            `${instance.id}.${port.name} requires ${port.contract} ${port.range} and nothing in this network's ` +
            'artifact set provides it'
          )
        }
        continue // optional, and absent rather than denied
      }

      bindings[port.name] = found[0].id
    }

    /** @type {Planned} */
    const spec = { id: instance.id, artifact: instance.artifact, kind: instance.kind.key, bindings }
    // An empty config is dropped rather than passed on. `instance.create`
    // always carries the field — a signed document has a fixed field set and
    // the canonical encoder refuses `undefined` — so `{}` is how an op spells
    // "no configuration", and `assemble.js` refuses config outright to a kind
    // that declared no schema. Sending it `{}` would fail every unconfigured
    // signed instance on a rule about a setting nobody wrote.
    if (instance.config !== undefined && Object.keys(instance.config).length > 0) spec.config = instance.config
    return spec
  }).sort((a, b) => cmp(a.id, b.id))
}

/**
 * Every instance that should exist, with the kind it runs and its config.
 *
 * @param {Record<string, import('artifact-protocol/manifest').Manifest>} manifests
 * @param {readonly Registered[]} permissions
 * @param {readonly Signed[]} signed
 */
function declare (manifests, permissions, signed) {
  /** @type {{ id: string, artifact: string, kind: any, config?: Record<string, unknown>, bindings?: Record<string, string | string[] | null> }[]} */
  const instances = []

  // Signed instances, indexed by the artifact and kind whose default they take
  // the place of — or, for a kind declaring `instances: explicit`, the only way
  // one exists at all. Everything a manifest can say about them is checked here,
  // because this is the first and only place both documents are in hand.
  /** @type {Map<string, typeof instances>} */
  const chosen = new Map()
  for (const s of signed) {
    const manifest = manifests[s.artifact]
    if (!manifest) {
      throw new PlanError(`instance ${s.id} names artifact ${s.artifact}, which is not in this network's set`)
    }
    const kind = manifest.kinds.find((k) => k.key === s.kind)
    if (!kind) {
      throw new PlanError(`instance ${s.id} names kind ${s.kind}, which ${s.artifact} does not have`)
    }
    if (kind.provides.some((/** @type {any} */ p) => p.id === PERMISSION)) {
      throw new PlanError(
        `instance ${s.id} names ${s.artifact}.${s.kind}, which provides ${PERMISSION}; how many permission ` +
        'instances exist is answered by permission.register and not by instance.create'
      )
    }
    for (const port of Object.keys(s.bindings)) {
      const declared = kind.ports.find((/** @type {any} */ p) => p.name === port)
      if (!declared) throw new PlanError(`instance ${s.id} binds ${port}, which ${s.kind} does not declare`)
      if (declared.contract.startsWith('platform:')) {
        throw new PlanError(
          `instance ${s.id} binds ${port}, a ${declared.contract} port the runtime fills; its target is not an ` +
          'instance id and no op can name one'
        )
      }
      if (s.bindings[port] === null && declared.cardinality !== 'optional') {
        throw new PlanError(`instance ${s.id} binds ${port} to null, but ${port} is ${declared.cardinality}; ` + (
          declared.cardinality === 'many'
            ? 'an empty many port is spelled [], which is a binding to no targets rather than no binding'
            : 'a one port has no unbound state — name a target, or leave the port out and it is derived'
        ))
      }
    }

    // Total over the discretionary ports, so that a forgotten capability is an
    // error and not an absence nobody can tell from a decision. The header
    // argues the rule and argues why `one` and `platform:*` are outside it.
    for (const port of kind.ports) {
      if (port.cardinality === 'one' || port.contract.startsWith('platform:')) continue
      if (Object.prototype.hasOwnProperty.call(s.bindings, port.name)) continue
      throw new PlanError(
        `instance ${s.id} does not bind ${port.name}, the ${port.cardinality} port ${s.kind} declares; a signed ` +
        "instance's bindings are total over the ports left to an admin's discretion, so spell the deliberate " +
        `emptiness as ${port.cardinality === 'many' ? '[]' : 'null'}`
      )
    }
    // NUL and not a space, and spelled `\\0` rather than written as a raw
    // byte: an artifact name cannot contain a space but a kind `key` is only
    // checked for being a non-empty string, so `a b` is ambiguous between two
    // pairs and NUL is the one character a JSON string will not carry. The raw
    // byte was here first and made `file(1)` call this source `data` and every
    // grep over it return nothing, which is a worse bug than the one it fixed.
    const key = `${s.artifact}\0${s.kind}`
    const list = chosen.get(key) ?? []
    list.push({ id: s.id, artifact: s.artifact, kind, config: s.config, bindings: s.bindings })
    chosen.set(key, list)
  }

  for (const name of Object.keys(manifests).sort(cmp)) {
    const manifest = manifests[name]
    const many = manifest.kinds.length > 1

    for (const kind of manifest.kinds) {
      // An artifact with one kind is named for itself, which keeps the common
      // case readable; one with several is disambiguated rather than guessed at.
      const base = many ? `${name}.${kind.key}` : name

      const replaced = chosen.get(`${name}\0${kind.key}`)
      if (replaced) {
        instances.push(...replaced)
        continue
      }

      if (kind.provides.some((p) => p.id === PERMISSION)) {
        // Refused rather than ignored. Both declarations say "not one per kind"
        // and they answer the successor question differently — the log, or a
        // signed instance — so honouring either would leave the other in force
        // and unread. Whichever won, an author or an admin would be wrong about
        // how many gates this network has, which is the one count in the system
        // nothing else can recompute.
        if (kind.instances === EXPLICIT) {
          throw new PlanError(
            `${name}.${kind.key} provides ${PERMISSION} and declares instances: ${EXPLICIT}; how many permission ` +
            'instances exist is answered by permission.register, so there is no default instance to opt out of'
          )
        }
        // A permission is an instance. How many there are is the network's
        // answer, not this artifact's — an artifact providing the permission
        // contract is the *implementation*, and the registrations are the data.
        for (const registered of permissions) {
          const declared = manifests[registered.artifact]?.permissions?.find((p) => p.id === registered.id)
          instances.push({
            id: `permission:${registered.id}`,
            artifact: name,
            kind,
            config: { id: registered.id, description: declared?.description ?? '' }
          })
        }
        continue
      }

      // A kind that opted out of the default. Nothing is declared for it and
      // that is not an error: the `chosen` lookup above is the only way one of
      // these comes to exist, and it has already run. See the header.
      if (kind.instances === EXPLICIT) continue

      instances.push({ id: base, artifact: name, kind })
    }
  }

  const seen = new Set()
  for (const i of instances) {
    if (seen.has(i.id)) {
      throw new PlanError(`two instances would both be called ${i.id}`)
    }
    seen.add(i.id)
  }

  return instances
}

/**
 * Which instances can fill this port.
 *
 * Three filters, then one narrowing. The family filter is the newest and is the
 * resolver's half of a feature whose other half shipped a while earlier: a
 * provider could already *declare* which presentation family its return type
 * belongs to, that declaration was enforced against its actual return at the call
 * boundary, and `chain.js` caught two providers disagreeing under one tag — but a
 * `ports` entry carried a contract, a range and a cardinality and nothing that
 * could read any of it.
 *
 * What that cost is worth stating, because it was not a missing convenience. Two
 * renderers of different families are two providers of one contract, so a `one`
 * port aimed at `renderer@2` on a network running both refused to derive, naming
 * both — a network with a CLI and a web view could not be planned at all unless
 * an admin hand-signed a binding for every renderer port on the device. The fact
 * needed to choose was in the signed document the whole time and nothing was
 * allowed to read it.
 *
 * A port that names no family is unchanged and takes any provider, which is what
 * every manifest written before the field says by saying nothing. It is
 * deliberately not "takes only providers that name no family": a contract without
 * a family has no tags to filter on, and on one that has them, a consumer that
 * did not ask has said it can cope — and would otherwise be silently narrowed to
 * the providers that also said nothing, which is a different port than the one
 * its author wrote.
 *
 * @param {{ id: string, artifact: string }} consumer
 * @param {{ name: string, contract: string, range: string, family?: string }} port
 * @param {Map<string, { id: string, version: string, artifact: string, family?: string }[]>} providers
 * @param {readonly Registered[]} permissions
 * @param {Map<string, Map<string, Declaration[]>>} declared
 */
function resolve (consumer, port, providers, permissions, declared) {
  const candidates = (providers.get(port.contract) ?? [])
    .filter((p) => p.id !== consumer.id)
    .filter((p) => semver.satisfies(p.version, port.range))
    .filter((p) => port.family === undefined || p.family === port.family)

  const found = port.contract === PERMISSION
    ? narrow(consumer, port, candidates, permissions)
    : candidates

  // After the narrowing and not before it, so a permission this artifact never
  // registered cannot fail a plan on a shape nobody here was going to call.
  substitutable(consumer, port, found, declared)
  return found
}

/**
 * A permission port gets only the permissions its own artifact registered.
 * Without this narrowing, every artifact's permission port would see every
 * permission on the network and the answer would be ambiguous the moment a
 * second artifact registered one.
 *
 * @param {{ id: string, artifact: string }} consumer
 * @param {{ name: string }} port
 * @param {{ id: string, version: string, artifact: string }[]} candidates
 * @param {readonly Registered[]} permissions
 */
function narrow (consumer, port, candidates, permissions) {
  const mine = new Map(
    permissions
      .filter((p) => p.artifact === consumer.artifact)
      .map((p) => [`permission:${p.id}`, local(p.id)])
  )
  const ours = candidates.filter((c) => mine.has(c.id))

  // With two or more, the port name picks: `send.share` fills a port called
  // `share`. Nothing else in a manifest says which gate a port is, and guessing
  // would hand an artifact a different permission than the one it is checking.
  const named = ours.filter((c) => mine.get(c.id) === port.name)
  return named.length === 1 ? named : ours
}

/**
 * Refuse a provider whose declared shape cannot stand in for the weakest one
 * the port's range commits its consumer to.
 *
 * The rule itself lives in `chain.js` and is called from here rather than
 * restated, because the same question is asked twice — once while deriving a
 * graph and once while validating one — and two implementations of one rule is
 * the drift this codebase keeps rediscovering. What stays here is the *verdict*:
 * derivation refuses by throwing, and a `PlanError` is what the boot path knows
 * how to report.
 *
 * See `chain.js` for why the baseline is the lowest satisfying declaration and
 * why every absence is a pass.
 *
 * @param {{ id: string, artifact: string }} consumer
 * @param {{ name: string, contract: string, range: string }} port
 * @param {readonly { id: string, version: string, artifact: string }[]} candidates
 * @param {Map<string, Map<string, Declaration[]>>} declared
 */
function substitutable (consumer, port, candidates, declared) {
  for (const candidate of candidates) {
    const bad = substitution(consumer.artifact, port, candidate.version, declared)
    if (bad === null) continue

    throw new PlanError(
      `${consumer.id}.${port.name} would take ${candidate.id}, which provides ${port.contract}@${candidate.version}; ` +
      `that cannot stand in for ${port.contract}@${bad.baseline}, the lowest version ${port.range} admits and ` +
      `so the weakest shape this port promised to work against — ${bad.problems.join('; ')}`
    )
  }
}

/** The part of a permission id after its artifact prefix: `send.share` -> `share`. */
const local = (/** @type {string} */ id) => id.slice(id.lastIndexOf('.') + 1)

/** @param {string} a @param {string} b */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

module.exports = { plan, PlanError, NATIVE }
