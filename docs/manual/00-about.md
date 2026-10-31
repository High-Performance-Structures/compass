# About this manual

This manual is the technical reference for Compass, a construction-management web application. It is written for an outside development team that needs to understand, analyse, change, optimise or rebuild Compass without any prior knowledge of it.

**Source.** Everything here was read from the Compass repository at the commit printed on the title page. File paths are relative to the repository root. When the manual and the code disagree, the code is right: report the difference and fix the manual.

**How it is built.** The chapters are Markdown files in `docs/manual/`, and the diagrams are Mermaid files in `docs/manual/diagrams/`. Run `bun scripts/manual/build.mjs` to:

- regenerate Appendices A to D and the ER diagrams from the code;
- check that no company-specific wording has crept in;
- render the diagrams locally;
- produce the Word and PDF editions in `build/manual/`.

Chapters 1 to 12 are written by hand. Update them in the same pull request as any change that makes them wrong.

**Company neutrality.** Compass is built to be adopted by any company, and this manual is written the same way. Examples use the fictional demo company *Summit Ridge Builders* or *Example Co*. Concepts that a company configures are described generically, for example the *company values board (name configurable)* and *configurable job-number prefixes*. Third-party products such as accounting, payments, e-signature, identity, workspace and hosting providers are named only as integrations, and the manual says where each one can be replaced.

**Legacy module names.** Two optional modules still use a company-specific folder name, table prefix and identifier prefix in the current source tree. This manual writes them as placeholders:

| Placeholder | Module | How to find it in the code |
|---|---|---|
| `{sales}` | Product sales / online ordering module | `ls src/lib` and look for the folder with `catalog-import.ts`, `bracing.ts` and `workflow.ts`; its tables end in `_catalog_versions`, `_order_workflows` and so on |
| `{values}` | Company values board | the folder under `src/components` with the pulse stream and story views; its tables end in `_pulse_responses`, `_card_fulfillments` |

Renaming these folders and tables to neutral names is on the roadmap (chapter 12).

**Secrets.** Environment variables, secrets and bindings appear by **name only**. No value, token, account id or key appears anywhere in this manual.

**Conventions.** In this manual:

- *Action* means a Next.js server action in `src/app/actions/`.
- *Store* means a domain module's `store.ts`.
- *Organization* (or *company*) is one tenant.
- Money is stored as integer cents unless a section says otherwise.
- Dates are ISO 8601 text.
