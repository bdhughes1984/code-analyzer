# GitHub Code Analyzer

A client-side web tool that assesses a candidate's GitHub contributions by analyzing their public repositories and scoring them out of 100. No backend required — runs entirely in the browser.

![Built with React](https://img.shields.io/badge/React-18-61dafb) ![D3.js](https://img.shields.io/badge/D3.js-7-f9a03c) ![No Backend](https://img.shields.io/badge/Backend-None-green)

## Live Demo

Open `index.html` in any browser, or visit the GitHub Pages deployment:

```
https://bdhughes1984.github.io/code-analyzer/
```

## What It Does

Enter any GitHub username and the tool will:

1. Fetch their public repositories via the GitHub API
2. Retrieve source files using the Git Trees + Blobs API
3. Run heuristic static analysis across three categories
4. Produce a detailed score breakdown out of 100

### Scoring Categories

| Category | Weight | What It Checks |
|---|---|---|
| **Code Quality** | 40 pts | Function length, naming conventions, comment ratio, code duplication, nesting depth, formatting consistency, error handling |
| **Runtime Performance** | 30 pts | Nested loops (O(n²)/O(n³)), string concatenation in loops, recursion without memoization, blocking calls, inefficient patterns, good patterns (hash structures, async, lazy eval) |
| **Memory Management** | 30 pts | Allocations inside loops, resource cleanup (RAII/context managers), global mutable state, memory leak patterns (event listeners, intervals, subscriptions), streaming vs full-file reads, caching |

### Supported Languages

Python, JavaScript, TypeScript, Java, C, C++, C#, Go, Rust, Ruby, PHP, Swift, Kotlin, Scala, Lua, R, HTML, CSS, Vue, Svelte, Zig, Elixir, Erlang, Haskell, OCaml, Perl, and **Jupyter Notebooks** (code cells are extracted and analyzed).

## Getting Started

### Option 1: Open Directly

Download `index.html` and open it in your browser. That's it.

### Option 2: GitHub Pages

1. Fork or clone this repo
2. Go to **Settings** → **Pages**
3. Set source to **Deploy from branch** → **main** → **/ (root)**
4. Your site will be live at `https://<your-username>.github.io/code-analyzer/`

## GitHub API Token (Recommended)

Without a token, GitHub limits you to **60 API requests per hour**, which restricts analysis to ~4 repos with ~6 files each. Adding a token raises this to **5,000 requests per hour**.

### Creating a token

1. Go to [github.com/settings/tokens](https://github.com/settings/tokens)
2. Click **Generate new token** → **Fine-grained token**
3. Name it anything (e.g. "Code Analyzer")
4. Set **Repository access** to **Public repositories (read-only)**
5. No additional permissions needed
6. Click **Generate token** and copy the `ghp_...` value

### Using the token

Click the **🔑 Add Token** button below the search bar, paste your token, then run the analysis. The token stays in your browser session only and is never stored or transmitted anywhere except directly to the GitHub API.

## How It Works

The tool uses two efficient GitHub API endpoints to minimize rate limit consumption:

- **`/git/trees/HEAD?recursive=1`** — returns the entire repository file tree in a single call (instead of one call per directory)
- **`/git/blobs/{sha}`** — fetches individual file contents by SHA

Analysis is performed entirely client-side using regex-based heuristic pattern matching. No code is executed, no data leaves your browser, and no external services are contacted beyond the GitHub API and CDN scripts.

### Architecture

```
index.html (single file)
├── React 18 (UI framework, loaded from CDN)
├── D3.js 7 (score gauge visualization, loaded from CDN)
├── Analysis Engine
│   ├── Code Quality analyzer (40 pts)
│   ├── Runtime Performance analyzer (30 pts)
│   └── Memory Management analyzer (30 pts)
├── GitHub API client (Trees + Blobs, with rate limit tracking)
└── Jupyter Notebook parser (extracts code cells from .ipynb)
```

## Configuration

These constants at the top of the script control analysis scope:

| Constant | Default | Description |
|---|---|---|
| `MAX_REPOS` | 8 | Max repositories to analyze (4 without token) |
| `MAX_FILES_PER_REPO` | 10 | Max files per repository (6 without token) |
| `MAX_FILE_SIZE` | 100,000 | Skip files larger than 100KB |

## Limitations

- **Heuristic analysis only** — pattern matching, not full AST parsing. Results are indicative, not definitive.
- **Public repos only** — private repositories require a token with additional scopes.
- **No runtime testing** — code is never executed, so actual performance and memory usage are not measured.
- **Rate limits** — without a token, analysis is limited. A free GitHub token removes this constraint.
- **Single file scope** — each file is analyzed independently; cross-file patterns (imports, shared state) are not tracked.

## License

MIT
