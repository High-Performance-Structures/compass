OpenClaw Memory System
===

how OpenClaw gives its agents persistent memory across sessions. covers the embedding pipeline, the SQLite schema that stores indexed chunks, the hybrid search strategy that combines vector similarity with keyword matching, and the pre-compaction memory flush that prevents the agent from losing important context when the conversation window fills up.

the central idea is that plain markdown files on disk are the source of truth. everything else — embeddings, indexes, caches — is derived and disposable. if you delete the SQLite database, the system rebuilds it from the markdown. if you edit a memory file by hand, the next sync picks up the changes. this is a deliberate choice: it keeps the system inspectable, Git-friendly, and resilient to corruption in a way that an opaque database wouldn't be.


the storage schema
---

memory lives in a single SQLite database per agent at `~/.openclaw/memory/<agentId>.sqlite`. the schema has four tables, each serving a distinct purpose.

**meta** stores a single JSON blob under the key `memory_index_meta_v1`. this records the embedding provider, model, provider key, chunk size, chunk overlap, and vector dimensions that were used to build the current index. the reason this exists is that embeddings from different models aren't comparable — you can't mix OpenAI `text-embedding-3-small` vectors with local `embeddinggemma-300M` vectors and get meaningful cosine similarity scores. when the meta changes (because the user switched providers), the system knows the entire index needs rebuilding.

```sql
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**files** tracks which markdown files have been indexed, their content hashes, modification times, and sizes. the hash is SHA-256 of the file content. during sync, each file's current hash is compared against the stored hash — if they match, the file is skipped. this is what makes incremental indexing fast: unchanged files cost nothing.

```sql
CREATE TABLE files (
  path TEXT PRIMARY KEY,
  source TEXT NOT NULL DEFAULT 'memory',
  hash TEXT NOT NULL,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL
);
```

the `source` column distinguishes between `"memory"` (files from the workspace memory directory) and `"sessions"` (indexed session transcripts, an experimental feature). this matters during search because the agent can filter results by source.

**chunks** is the core table. each row is a text chunk — a slice of a markdown file — along with its embedding vector, the model that produced it, and its position in the source file (start/end line numbers).

```sql
CREATE TABLE chunks (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'memory',
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  hash TEXT NOT NULL,
  model TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
```

the embedding is stored as a JSON array of floats in the `embedding` column. this is the fallback representation — it works everywhere but requires deserializing and computing cosine similarity in application code. when the sqlite-vec extension is available, the system also maintains a virtual table (`chunks_vec`) that stores the same embeddings as binary blobs and supports hardware-accelerated distance computation.

**embedding_cache** prevents re-embedding text that hasn't changed. the composite primary key is `(provider, model, provider_key, hash)` — meaning the same text embedded with the same model produces a cache hit regardless of which file it came from. this matters for overlapping chunks, which by design share text at their boundaries.

```sql
CREATE TABLE embedding_cache (
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  provider_key TEXT NOT NULL,
  hash TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dims INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (provider, model, provider_key, hash)
);
```


chunking
---

markdown files get split into chunks before embedding. the chunking is line-based, not sentence-based, which means heading structure and paragraph boundaries in the markdown are respected.

the target chunk size defaults to 400 tokens (approximated as `tokens * 4` characters). the overlap defaults to 80 tokens. overlap exists because embedding models need surrounding context to produce useful vectors — a chunk that starts mid-paragraph would lose the semantic framing that the previous lines provided. by carrying the last ~80 tokens of one chunk into the beginning of the next, the system ensures that ideas spanning chunk boundaries are represented in at least one chunk's embedding.

each chunk records its start and end line numbers in the source file. this is what makes the `memory_get` tool work — after `memory_search` identifies a relevant chunk, the agent can request the exact lines from the original file, including surrounding context that the chunk might not contain.

long lines get split into segments at the `maxChars` boundary before chunking. this prevents a single extremely long line from creating an oversized chunk, which would produce a poor embedding (most embedding models have a token limit, and truncation happens silently).


the embedding pipeline
---

embeddings are produced by one of three providers, selected in order of preference:

1. **local** via `node-llama-cpp` — runs a GGUF model locally. the default is `embeddinggemma-300M-Q8_0`, a 300M parameter model that produces reasonable embeddings without needing a GPU. the advantage is zero network calls and no API costs. the disadvantage is that it needs `node-llama-cpp` installed, which requires native compilation and doesn't work on all platforms.

2. **openai** — calls the OpenAI embeddings API (`text-embedding-3-small` by default). good quality, fast, but costs money and requires network access.

3. **gemini** — calls Google's embedding API. similar tradeoffs to OpenAI.

the provider selection logic (`"auto"` mode) tries local first if a model file exists on disk, then falls back to OpenAI, then Gemini. if the primary provider fails (missing API key, network error, unsupported platform), the system falls back to the configured fallback provider. this fallback is tracked — the system records which provider it fell back from and why, which surfaces in status output so the user knows their local setup is broken.

all embeddings are L2-normalized after generation. this is a preprocessing step that converts them to unit vectors, which means cosine similarity reduces to a dot product. this matters because sqlite-vec's `vec_distance_cosine` expects normalized vectors, and the brute-force fallback (`cosineSimilarity()`) also benefits from consistent normalization.

the embedding provider interface is deliberately simple:

```typescript
type EmbeddingProvider = {
  id: string;
  model: string;
  embedQuery: (text: string) => Promise<number[]>;
  embedBatch: (texts: string[]) => Promise<number[][]>;
};
```

`embedQuery` is for search-time (single query), `embedBatch` is for index-time (many chunks). the distinction matters because some providers offer batch APIs at lower cost (OpenAI and Gemini both support this), and the system routes bulk indexing through those APIs when available.

batch indexing runs with concurrency of 4, retry logic with exponential backoff (500ms base, 8s max, 3 attempts), and a failure limit of 2 — after two consecutive batch failures, the system gives up on batch mode for the session and falls back to sequential embedding. this prevents a flaky API from stalling the entire index.


how search works
---

search is hybrid — it combines two fundamentally different retrieval strategies and merges their results.

**vector search** (semantic) embeds the query text using the same provider/model that produced the index, then finds the nearest chunks by cosine distance. this catches conceptual matches — searching for "user preferences" will find chunks that talk about "settings" or "configuration" even if those exact words don't appear. when sqlite-vec is available, this runs as a SQL query with `vec_distance_cosine()`, which is fast. when it's not available, the system falls back to brute-force: load all chunk embeddings into memory, compute cosine similarity against each one, sort, and take the top N. this fallback is obviously slower but works on any SQLite build.

**keyword search** (lexical) uses SQLite FTS5. the raw query gets tokenized into individual words, joined with AND, and matched against the full-text index. results are ranked by BM25, which is SQLite's built-in relevance scoring. this catches exact matches — searching for "Peter" will find chunks that mention Peter by name, which vector search might miss if "Peter" isn't a semantically distinctive token in the embedding space.

the two result sets are merged by a weighted score:

```
finalScore = vectorWeight * vectorScore + textWeight * textScore
```

default weights are 0.7 vector / 0.3 text. this weights semantic similarity higher, which makes sense as a default — you usually want conceptual matches. but the keyword component prevents the system from missing exact-match results that vector search would rank lower.

the merge works by chunk ID. if the same chunk appears in both result sets (which is common — a chunk that's semantically similar to the query often also contains the query terms), it gets the combined score. if a chunk appears in only one result set, it gets the full weight for that component and zero for the other. results are sorted by combined score, descending, and truncated to `maxResults` (default 6).

the BM25 rank-to-score conversion uses `1 / (1 + rank)`, which maps BM25's unbounded rank values into a 0-1 range. this is necessary because the vector scores are already normalized (cosine similarity is inherently 0-1 for normalized vectors), and the merge formula needs both components on the same scale.


the pre-compaction memory flush
---

this is the mechanism that prevents the agent from losing important context when the conversation gets long.

the problem it solves: LLM context windows are finite. when a conversation approaches the context limit, OpenClaw compacts the history — older messages get summarized or removed to free space. but compaction is lossy. if the agent learned something important early in the conversation (a user preference, a decision, a key fact), that information might get compacted away and effectively forgotten.

the flush is a silent agentic turn that runs just before compaction. the trigger condition is:

```
totalTokens >= contextWindow - reserveTokensFloor - softThresholdTokens
```

with defaults of 20,000 for `reserveTokensFloor` and 4,000 for `softThresholdTokens`. so on a model with a 200K context window, the flush triggers when token usage crosses ~176K.

when triggered, the system injects a special prompt into the conversation:

> Pre-compaction memory flush. Store durable memories now (use memory/YYYY-MM-DD.md; create memory/ if needed). If nothing to store, reply with NO_REPLY.

this runs as a full agentic turn — the agent has access to all its tools, including file write. it can decide what's worth saving (preferences discovered during the conversation, decisions made, important facts) and write those to the daily memory log or to MEMORY.md. then compaction proceeds, and the saved information is recoverable via `memory_search` in future sessions.

the flush only runs once per compaction cycle. this is tracked via `memoryFlushCompactionCount` on the session entry — the flush records the current compaction count, and subsequent checks see that the flush has already run for this count and skip it. this prevents the flush from firing repeatedly as the conversation hovers near the threshold.

there are additional guardrails. the flush won't run during heartbeat polls (automated keep-alive messages where no real conversation is happening). it won't run for CLI providers (where compaction works differently). and it checks sandbox write permissions — if the workspace isn't writable, there's no point asking the agent to write files.

the prompt includes a `NO_REPLY` token hint because most of the time the agent has nothing to save. the user never sees this turn. if the agent writes files, those writes happen silently. if there's nothing to save, the agent replies with the silent token and the system discards it. the entire mechanism is invisible to the user unless they inspect the session transcript.


the two-path vector search
---

one detail worth calling out: vector search has two code paths, and the choice between them is automatic.

**path 1: sqlite-vec.** when the extension is available and loaded, embeddings are stored in a virtual table (`chunks_vec`) as binary blobs. search runs as a SQL query that joins the vector table against the chunks table, computes `vec_distance_cosine()` in native code, and returns results sorted by distance. this is efficient — it uses SIMD instructions on supported hardware and doesn't require loading all embeddings into application memory.

**path 2: brute-force.** when sqlite-vec isn't available (it's an optional extension that requires native compilation), the system falls back to loading every chunk's embedding from the `chunks` table, deserializing the JSON arrays, computing cosine similarity in JavaScript, sorting, and returning the top N. this is O(n) in the number of chunks and involves a lot of memory allocation, but it works on any SQLite build.

the system tries to load sqlite-vec on startup with a 30-second timeout. if it fails (missing extension, incompatible platform, permission error), it logs the error and falls back silently. the user can check `openclaw memory status --deep` to see which search path is active.

this two-path design is a practical compromise. sqlite-vec offers meaningful performance gains for large memory stores (thousands of chunks), but requiring it would make memory search unavailable on platforms where the extension doesn't compile. by making it optional with a transparent fallback, the system works everywhere while performing well where conditions allow.


what this means for compass
---

if Compass integrates with OpenClaw's memory system, there are a few things worth understanding:

the memory system is designed for a single agent per database. each agent gets its own SQLite file, its own embedding index, and its own sync lifecycle. if Compass runs multiple AI sessions (per-user, per-project, per-workspace), each would need its own memory scope. this maps naturally to OpenClaw's agent model but requires thinking about how Compass sessions map to OpenClaw agent IDs.

the embedding provider choice affects both cost and quality. for a deployed product, the OpenAI path is the most reliable (no native dependencies, consistent quality, reasonable cost). the local path is attractive for privacy-sensitive deployments but adds complexity (node-llama-cpp compilation, model downloads). the auto-selection logic handles this gracefully, but Compass would want to make the choice explicit rather than relying on auto.

the pre-compaction flush is designed for long-running conversational sessions. if Compass's AI interactions are shorter (task-oriented, not open-ended), the flush might never trigger. but for a project management tool where the AI maintains context across weeks of interaction, the flush becomes essential — it's the difference between the AI remembering that "the client prefers blue over green" and having to be told again.

the hybrid search strategy means that memory recall is robust to both conceptual and exact-match queries. this matters for a project tool: searching for "deadline" should find notes that mention "due date" (semantic), and searching for "Martine" should find notes that mention Martine by name (keyword). neither search strategy alone handles both cases well.
