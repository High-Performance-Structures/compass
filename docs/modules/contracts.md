Contract Library and Project Packets
===

The contracts module turns approved source documents into versioned templates,
then snapshots selected versions into a project-specific contract packet. A
packet always links to one exact estimate version, which is inserted as CA22.
Published library changes never alter an existing project packet.


document lifecycle
---

Internal staff manage contract templates in the Contract documents tab of the
Template Library. Importing the approved source workbook creates the initial
published versions. A later source refresh creates drafts when content has
changed; staff must review and publish those versions explicitly. Each version
also has a Markdown copy in the configured Google Drive Template Library under
`Contracts`.

Templates define an inclusion mode and a signing stage:

- `embedded`: render the document body in a packet.
- `reference`: list the document in CA00 without embedding its full body.
- `generated`: create the document from current Compass data, such as CA22.
- `contract`: include the document in the initial signing envelope.
- `construction`: retain it for a later construction event.
- `closeout`: retain it for final walk-through or closeout signing.
- `reference`: make it part of the contract schedule without a signing event.

The Homeowner's Warranty Manual is reference-only. Inspection and limited
warranty forms can be retained as closeout documents without appearing in the
initial Foxit envelope.


project packets
---

The Estimate workspace offers two signature routes: estimate-only, or a full
construction contract. Creating a full packet copies every currently published,
department-eligible template and links the selected estimate version. Staff can
remove documents, add a missing published document, or edit the project snapshot
without changing the global template.

CA00's contract-document schedule is generated from the exact selected packet
documents, including dates, revisions, reference treatment, and closeout
treatment. Project department determines the default contractor legal entity.
The entity remains editable on a draft packet. The deposit is entered as a
required percentage of the linked estimate total; Compass calculates and stores
the corresponding dollar amount so the contract text cannot drift from CA22.


PDF and signature workflow
---

Compass creates one letter-size PDF by rendering contract-stage Markdown,
inserting the linked CA22 estimate, and appending a consolidated signature page.
Every Compass-rendered contract page carries the project department's company
logo and contact details. Draft previews open inside the Contract workspace,
with a separate download action when a local copy is needed.
The final pass adds `Page # of #` to every page, required Foxit initials fields
to every page except the full-signature page, and signature plus system date
fields for every owner signer and the company representative.

Preparing a Foxit envelope does not freeze the draft. If a user edits the packet
after preparation, Compass invalidates the prepared session so a fresh PDF must
be created. Foxit's `folder_sent` event freezes both packet and linked estimate.
Its `folder_executed` event executes the packet, accepts the exact estimate,
supersedes the previous contractual baseline, and rebuilds the project contract
budget. Revisions after sending use packet duplication.

For documents signed outside Compass, internal staff first mark the packet as
sent or printed. They then upload or link the complete signed copy, attest that
all required signatures are present, and record the execution date. This path
performs the same estimate approval, locking, and contract-budget rebuild.


implementation map
---

- Schema: `src/db/schema-contracts.ts`
- Migrations: `drizzle/0130_contract_packets.sql`,
  `drizzle/0131_contract_deposit_rate.sql`
- Template actions: `src/app/actions/contract-templates.ts`
- Packet actions: `src/app/actions/contract-packets.ts`
- Source normalization: `src/lib/contracts/source.ts`
- PDF assembly: `src/lib/contracts/packet-pdf.ts`
- Foxit completion: `src/app/api/integrations/foxit/webhook/route.ts`
