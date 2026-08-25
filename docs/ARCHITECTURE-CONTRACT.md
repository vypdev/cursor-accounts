# Clean Architecture Contract

This is the executable architecture contract for Cursor Accounts. It defines
dependency direction, layer ownership, permitted exceptions, and the checks
that must pass before a change is considered complete.

**Status:** active  
**Last reviewed:** 2026-08-25  
**Enforcement:** `pnpm run check:architecture` and
`pnpm run test:architecture`

## Architectural objective

The extension follows Clean Architecture and ports-and-adapters principles:
business rules remain independent from VS Code, Node.js, HTTP, SQLite, the
MITM implementation, and the webview. Concrete adapters are assembled by the
composition root and are exposed to use cases through domain-owned ports.

The directory layout is a useful map, not the contract by itself. The
contract is the resolved import graph and the rules below.

## Layers

| Layer | Canonical locations | Responsibility | May depend on |
|---|---|---|---|
| Shared kernel | `packages/types/src`, `packages/shared/src` | Stable entities, pure rules, shared host/webview contracts, pure utilities | The shared kernel and TypeScript only; no extension implementation, Node, or VS Code |
| Domain | `src/domain` | Business concepts, domain services, and capability ports | Domain modules and the shared kernel |
| Application | `src/application` | Use-case orchestration, application records, persistence policies, and coordination | Application modules, domain modules, and the shared kernel |
| Infrastructure and adapters | `src/api`, `src/auth`, `src/cursor`, `src/github`, `src/logging`, `src/migrations`, `src/modelEfficiency`, `src/persistence`, `src/profiles`, `src/proxy`, `src/services`, `src/storage`, `src/validation`, `src/utils`, `src/config.ts` | External systems, process and filesystem access, protocol translation, scheduled workflows, and concrete port implementations | Domain, application, shared kernel, and approved external dependencies |
| Interface adapters | `src/commands`, `src/ui`, `webview/src` | VS Code commands, presenters, host/webview messages, and user-facing rendering | Application use cases, domain ports, infrastructure facades, and shared contracts |
| Composition root | `src/extension.ts`, `src/composition` | Lifecycle entrypoints, concrete construction, dependency injection, and wiring | All implementation layers |
| Tests | `src/test`, `webview/src/**/*.test.*`, fixtures | Verification and characterization | Any production layer required by the test |

`src/extension.ts` and `src/composition` are the only production locations
treated as composition roots. A module outside those locations must not import
the composition root.

## Dependency rules

Dependencies point inward at the policy boundary:

```text
Composition root
       ↓ constructs
Interface adapters and infrastructure
       ↓ implement / invoke
Application use cases
       ↓ depend on
Domain rules and ports
       ↓ use
Shared kernel
```

The following rules are mandatory:

1. Domain code must not depend on application, infrastructure, interface
   adapters, VS Code, Node runtime APIs, or external runtime libraries. The
   only approved non-relative domain packages are
   `@cursor-accounts/shared` and `@cursor-accounts/types`.
2. Application code must not depend on concrete infrastructure or interface
   adapters. Its only approved external packages are the two shared-kernel
   packages above; Node and VS Code runtime dependencies are forbidden.
3. Shared-kernel packages must not depend on `src`, VS Code, Node built-ins,
   or extension runtime libraries.
4. Infrastructure may implement domain ports and may use external libraries,
   but proxy infrastructure must not import UI presenters. Presentation is
   reached through ports or application-facing coordinators.
5. The composition root may construct concrete adapters, but no other layer
   may depend on it.
6. Unresolved relative imports are errors. A source import ending in `.js`,
   `.mjs`, or `.cjs` must resolve to the corresponding TypeScript source when
   the source exists.
7. Workspace package imports are resolved against package manifests and source
   entrypoints when build output is absent. A package boundary must be crossed
   through its declared package name, not by reaching into another package's
   filesystem with a relative path.
8. Static import cycles are errors. Type-only and runtime imports follow the
   same architectural direction unless an explicit exception is recorded.
9. Tests and generated output are not part of the production boundary graph by
   default. They are still covered by the normal typecheck and test suites.

## Enforced diagnostic rules

The checker reports the source file, line, import kind, target layer, and one
of these rule identifiers:

| Rule | Meaning |
|---|---|
| `domain-depends-outward` | Domain imports application or an outer implementation layer |
| `domain-external-dependency` | Domain imports an unapproved external package |
| `application-depends-on-infrastructure` | Application imports a concrete outer adapter |
| `application-invalid-target` | Application imports an undeclared layer |
| `application-external-dependency` | Application imports an unapproved external package |
| `application-runtime-dependency` | Application imports Node or VS Code runtime APIs |
| `shared-kernel-runtime-dependency` | Shared kernel imports Node or VS Code |
| `shared-kernel-depends-on-extension` | Shared kernel reaches into `src` |
| `infrastructure-depends-on-interface` | Proxy infrastructure imports a UI presenter |
| `composition-root-only` | A non-root production layer imports the composition root |
| `unresolved-relative-import` | A relative import cannot be resolved safely |
| import cycle | The resolved source graph contains a static cycle |

## Tooling contract

The checker uses the TypeScript compiler API rather than regular expressions.
It parses static imports, export declarations, `import()`, `require()`, and
TypeScript import-equals declarations. It uses TypeScript module resolution,
with a workspace-source fallback for packages whose `dist` output is not
present.

Run the production graph and the independent checker fixtures with:

```bash
pnpm run check:architecture
pnpm run test:architecture
```

For CI integrations or audit artifacts, the graph can be emitted as JSON:

```bash
node scripts/check-architecture.mjs --json
```

The fixture suite must retain at least one legal case and negative cases for
domain boundaries, application boundaries, unapproved external dependencies,
unresolved imports, workspace package resolution, and cycles.

## Change protocol

When adding or moving a module:

1. Assign it to a layer before writing imports.
2. Depend on a domain port or application use case rather than a concrete
   adapter when the dependency represents a capability.
3. Run the architecture checker and its fixtures before the focused tests.
4. If an outward dependency is genuinely required, first introduce a narrow
   port or shared contract. Do not weaken a rule to make an import pass.
5. Record any temporary compatibility exception in an ADR with an owner,
   reason, scope, and removal condition. There are no implicit exceptions.

This contract does not require every module to be tiny. It requires each
dependency direction and boundary to be explicit, testable, and reviewable.
