# artifact-planner

Which instances a network runs, what each one may reach, and whether the whole
graph is valid — derived and judged from signed documents alone. No device, no
swarm, no realm, no clock.

Two modules and one subject:

- **`lib/plan.js`** — signed network state and fetched manifests in, an instance
  graph out. A pure function: two devices given the same view derive the same
  wiring or the code is wrong.
- **`lib/chain.js`** — is that graph valid? **Every** problem rather than the
  first, each with the shortest path from a root, sorted so two runs over the
  same inputs produce the same bytes.

Part of the **artifact platform** — a signed peer-to-peer artifact ecosystem.

- **Runtime:** [Bare](https://github.com/holepunchto/bare), not Node
- **Design:** each file's own header, and `AGENTS.md` §3, §4 and §9 in
  [artifact-platform](https://github.com/AustinPoonia/artifact-platform)

## Usage

```js
const { plan, chain } = require('artifact-planner')

// Manifests by artifact name, plus what the network's signed log says.
const specs = plan(manifests, { permissions, instances })

const verdict = chain.validate(manifests, specs)
if (!verdict.ok) throw new Error(chain.explain(verdict))
```

`plan` throws a `PlanError` for a graph it cannot derive at all — two providers
for a `one` port, a required port nothing satisfies, a signed instance naming a
kind that is not there. `chain.validate` never throws: it returns a list, and the
list is complete.

The kernel calls both, in that order, between fetching artifacts and building
anything. `artifact-operator`'s `network check` calls the same two functions over
*unsigned* state, which is the whole point of them being pure — an admin gets the
verdict a device would give, before signing, without a device.

## What the two of them together buy

Every rule about how instances fit used to be enforced wherever it happened to
come up: the planner threw on the first port it could not resolve, the assembler
refused an instance after building it, and the manifest parser checked what one
document could decide alone. So an admin composing network state found out their
wiring was wrong by signing it, deploying it, and watching a machine somewhere
fail to boot — then fixed one thing and did it again.

A verdict that needs a device is a verdict nobody can get before signing, and a
verdict that stops at the first problem is a boot-and-retry loop with extra
steps. Both halves of that are why this is a pure function of documents.

## What it cannot say

It reads declarations, so it inherits every limit declarations have.

- **Not conformance.** Whether a provider actually implements the operations it
  claims needs the built instance's method list, which needs a realm. The kernel's
  `assemble.js` owns that and always will.
- **Not behaviour.** Two shapes agreeing is not two implementations agreeing. An
  operation that quietly began returning cents passes untouched.
- **Not the plan, when `chain` is the one asked.** A graph `plan` refused to
  derive never reaches the validator, and those ambiguity errors are the planner's
  alone.

A clean verdict means the graph is wired the way its documents say. It does not
mean the code behind those documents works.

## Why the two are one repository

`chain.js` and `plan.js` share rule implementations deliberately: `visible`,
`substitution` and the `NATIVE` capability table are declared in `chain.js` and
imported by `plan.js`, so the validator an admin runs before signing and the
derivation a device runs at boot cannot answer differently. The failure this
codebase keeps removing is two copies of one rule drifting apart, and two
repositories is the most reliable way there is to produce them. Splitting these
would have recreated it on purpose.

## Why this is a repository at all

The rule `all-repos.sh --check-doors` enforces: **a module is a repo when
something that is not its host imports it.** Both of these were imported by
subpath from `artifact-operator/lib/check.js` —
`artifact-platform/lib/chain.js` and `artifact-platform/lib/plan.js` — and the
comment at that call site says why it reaches past the front door instead of
through it: the bare specifier loads the kernel's `index.js`, which drags
`bare-realm`, `corestore` and `hyperswarm` into every invocation of every verb.

The reaching was the evidence, not the problem. What made it answerable is that
these two files are pure: between them they require `artifact-protocol` and each
other, and that is the entire graph. Nothing else in the kernel is reachable from
here, which is also why `artifact-operator/test/guards.test.js` could walk it
transitively and know it before the move rather than hope after.

`artifact-platform` keeps both doors. `lib/chain.js` and `lib/plan.js` there are
one-line re-exports, `index.js` still exports `chain` and `plan`, and
`package.json` still declares both subpaths — so no consumer changed and nothing
outside this split had to learn the new name.

## Development

```
npm test         # 114 cases under the Bare runtime
npm run typecheck
```

There is no fixture directory and no mock, because there is nothing to mock: every
input is a document. `manifest.parse` from `artifact-protocol` builds the fixtures
and several cases deliberately reach *past* it to write shapes a signed manifest
could not carry, which is the honest way to test what a hand-built spec does to a
validator.

### The fifteen cases that stayed behind

The two suites held 129 cases in `artifact-platform` and 114 are here. The split
of the suite falls in a different place from the split of the code — the third
time in a row that has been true in this tree — and each file's header argues its
own half:

- **`chain.test.js`, 69 → 65.** Three of the four that stayed drive the kernel's
  `boot.mintNatives`, two of them by scraping the live function with
  `Function.prototype.toString`; they assert that the `NATIVE` table here, the
  switch the kernel dispatches on, and `artifact-protocol`'s
  `capability.PLATFORM_CONTRACTS` are one set. The fourth validates the real
  manifests of seven shipped artifacts.
- **`plan.test.js`, 60 → 49.** The eleven that stayed load the real manifests of
  eight artifact repositories and assert what a network made of them derives.

Moving those fifteen would have meant declaring eight `file:../` links to artifact
repositories here, so a library whose whole claim is that it needs nothing but
documents could not be installed without the concrete artifacts it judges. That is
the inversion the split exists to remove — not a cycle, but the same shape — so
they stay in `artifact-platform`, whose suite is where the shipped set is
assembled, and both of that repo's files say so in their headers.

The division is the seam and not a compromise: the suites here prove the rules,
and the fifteen there prove the rules are wired to the artifacts that ship and
that the kernel and this module still answer as one. All fifteen reach this code
through `artifact-platform`'s re-exports, so they also assert the doors still open.

## License

Apache-2.0
