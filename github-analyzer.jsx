import { useState, useEffect, useRef, useCallback } from "react";
import * as d3 from "d3";

// ─── Constants & Config ───────────────────────────────────────────────────────
const GITHUB_API = "https://api.github.com";
const MAX_REPOS = 8;
const MAX_FILES_PER_REPO = 10;
const MAX_FILE_SIZE = 100000;
const ANALYZABLE_EXTENSIONS = new Set([
  "py","js","ts","tsx","jsx","java","c","cpp","h","hpp","cs","go","rs",
  "rb","php","swift","kt","scala","sh","bash","lua","r","m","mm",
]);

// ─── Heuristic Analysis Engine ────────────────────────────────────────────────

function getExtension(filename) {
  const parts = filename.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}

function isAnalyzable(filename) {
  return ANALYZABLE_EXTENSIONS.has(getExtension(filename));
}

// Code Quality Metrics (40 pts)
function analyzeCodeQuality(content, filename) {
  const lines = content.split("\n");
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  const ext = getExtension(filename);
  let score = 40;
  let findings = [];

  // 1. Function length analysis
  const funcPattern = /(?:function\s+\w+|def\s+\w+|fn\s+\w+|\w+\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)|\w+\s*\([^)]*\)\s*\{|func\s+\w+|public\s+\w+\s+\w+\s*\()/g;
  const funcMatches = content.match(funcPattern) || [];
  const avgFuncCount = funcMatches.length;

  if (nonEmpty.length > 0 && avgFuncCount > 0) {
    const avgLinesPerFunc = nonEmpty.length / avgFuncCount;
    if (avgLinesPerFunc > 60) {
      score -= 8;
      findings.push({ type: "warning", msg: "Very long functions detected (avg >" + 60 + " lines)" });
    } else if (avgLinesPerFunc > 40) {
      score -= 4;
      findings.push({ type: "warning", msg: "Long functions detected (avg >" + 40 + " lines)" });
    } else if (avgLinesPerFunc <= 20) {
      findings.push({ type: "good", msg: "Well-decomposed functions" });
    }
  }

  // 2. Naming conventions
  const singleCharVars = content.match(/(?:let|var|const|int|float|double|string|auto)\s+[a-z]\s*[=;,)]/g) || [];
  const meaninglessNames = content.match(/(?:let|var|const)\s+(?:temp|tmp|data|val|res|ret|obj|arr|str|num|flag)\s*=/g) || [];
  if (singleCharVars.length > 5) {
    score -= 5;
    findings.push({ type: "warning", msg: `${singleCharVars.length} single-character variable names` });
  }
  if (meaninglessNames.length > 3) {
    score -= 3;
    findings.push({ type: "info", msg: `${meaninglessNames.length} generic variable names (temp, data, etc.)` });
  }

  // 3. Comment ratio
  const commentPatterns = [/^\s*\/\//, /^\s*#(?!!)/, /^\s*\/\*/, /^\s*\*/, /^\s*\*\//, /^\s*"""/, /^\s*'''/, /^\s*--/];
  const commentLines = lines.filter((l) => commentPatterns.some((p) => p.test(l))).length;
  const commentRatio = nonEmpty.length > 0 ? commentLines / nonEmpty.length : 0;
  if (commentRatio < 0.03 && nonEmpty.length > 30) {
    score -= 4;
    findings.push({ type: "warning", msg: "Very few comments (" + (commentRatio * 100).toFixed(1) + "%)" });
  } else if (commentRatio >= 0.1 && commentRatio <= 0.3) {
    findings.push({ type: "good", msg: "Healthy comment ratio (" + (commentRatio * 100).toFixed(1) + "%)" });
  }

  // 4. Code duplication (simple check: repeated lines)
  const lineFreq = {};
  nonEmpty.forEach((l) => {
    const trimmed = l.trim();
    if (trimmed.length > 15) lineFreq[trimmed] = (lineFreq[trimmed] || 0) + 1;
  });
  const duplicates = Object.values(lineFreq).filter((c) => c > 2).length;
  if (duplicates > 10) {
    score -= 6;
    findings.push({ type: "warning", msg: `Significant code duplication (${duplicates} repeated patterns)` });
  } else if (duplicates > 5) {
    score -= 3;
    findings.push({ type: "info", msg: `Some code duplication detected` });
  }

  // 5. Cyclomatic complexity (nesting depth)
  let maxDepth = 0, currentDepth = 0;
  lines.forEach((line) => {
    const opens = (line.match(/\{/g) || []).length;
    const closes = (line.match(/\}/g) || []).length;
    currentDepth += opens - closes;
    if (currentDepth > maxDepth) maxDepth = currentDepth;
  });
  if (maxDepth > 8) {
    score -= 6;
    findings.push({ type: "warning", msg: `Deep nesting detected (max depth: ${maxDepth})` });
  } else if (maxDepth > 5) {
    score -= 3;
    findings.push({ type: "info", msg: `Moderate nesting depth (${maxDepth})` });
  } else if (maxDepth <= 4 && nonEmpty.length > 10) {
    findings.push({ type: "good", msg: "Clean, shallow nesting" });
  }

  // 6. Line length
  const longLines = lines.filter((l) => l.length > 120).length;
  if (longLines > lines.length * 0.2) {
    score -= 3;
    findings.push({ type: "info", msg: `${longLines} lines exceed 120 characters` });
  }

  // 7. Consistent formatting (mixed indentation)
  const tabLines = lines.filter((l) => l.startsWith("\t")).length;
  const spaceLines = lines.filter((l) => /^ {2,}/.test(l)).length;
  if (tabLines > 5 && spaceLines > 5) {
    score -= 3;
    findings.push({ type: "warning", msg: "Mixed tabs and spaces indentation" });
  }

  // 8. Error handling
  const hasTryCatch = /try\s*\{|try:|except|catch\s*\(|rescue|recover/.test(content);
  const hasThrow = /throw\s|raise\s|panic\(/.test(content);
  if (nonEmpty.length > 50 && !hasTryCatch && !hasThrow) {
    score -= 3;
    findings.push({ type: "info", msg: "No error handling patterns detected" });
  } else if (hasTryCatch) {
    findings.push({ type: "good", msg: "Error handling present" });
  }

  return { score: Math.max(0, score), findings, category: "Code Quality", maxScore: 40 };
}

// Runtime Performance Metrics (30 pts)
function analyzePerformance(content, filename) {
  const lines = content.split("\n");
  let score = 30;
  let findings = [];

  // 1. Nested loops (O(n²) or worse)
  let loopDepth = 0, maxLoopDepth = 0;
  const loopPatterns = /\b(for|while|forEach|map|filter|reduce|\.each|loop)\b/;
  lines.forEach((line) => {
    if (loopPatterns.test(line)) loopDepth++;
    if (/^\s*\}|^\s*end\b|^\s*$/.test(line) && loopDepth > 0) {
      // simplified: reduce on closing structures
    }
    if (loopDepth > maxLoopDepth) maxLoopDepth = loopDepth;
  });

  // Better nested loop detection
  const nestedLoopPattern = /(?:for|while)[^{]*\{[^}]*(?:for|while)/gs;
  const nestedLoops = (content.match(nestedLoopPattern) || []).length;
  if (nestedLoops > 3) {
    score -= 8;
    findings.push({ type: "warning", msg: `${nestedLoops} nested loop patterns (potential O(n²)+)` });
  } else if (nestedLoops > 0) {
    score -= 3;
    findings.push({ type: "info", msg: `${nestedLoops} nested loop(s) found — review for optimization` });
  }

  // Triple nesting
  const tripleNested = /(?:for|while)[^{]*\{[^}]*(?:for|while)[^{]*\{[^}]*(?:for|while)/gs;
  if (tripleNested.test(content)) {
    score -= 6;
    findings.push({ type: "warning", msg: "Triple-nested loops detected (O(n³) complexity)" });
  }

  // 2. String concatenation in loops
  const stringConcatInLoop = /(?:for|while)[^{]*\{[^}]*(?:\+\=\s*["'`]|\.concat\(|string\s*\+)/gs;
  if (stringConcatInLoop.test(content)) {
    score -= 4;
    findings.push({ type: "warning", msg: "String concatenation inside loop (use builder/join)" });
  }

  // 3. Recursive patterns without memoization
  const recursiveFuncs = content.match(/function\s+(\w+)[^{]*\{[^}]*\1\s*\(/gs) || [];
  const hasMemo = /memo|cache|lru_cache|@cache|memoize|useMemo/.test(content);
  if (recursiveFuncs.length > 0 && !hasMemo) {
    score -= 4;
    findings.push({ type: "info", msg: "Recursion without visible memoization" });
  } else if (recursiveFuncs.length > 0 && hasMemo) {
    findings.push({ type: "good", msg: "Memoized recursion pattern" });
  }

  // 4. Inefficient patterns
  const inefficientPatterns = [
    { pattern: /\.indexOf\([^)]+\)\s*!==?\s*-1/g, msg: "indexOf for existence check (use includes/has/Set)", penalty: 2 },
    { pattern: /Array\(.*?\)\.fill|new Array\(\d{4,}\)/g, msg: "Large array allocation", penalty: 3 },
    { pattern: /JSON\.parse\(JSON\.stringify/g, msg: "Deep clone via JSON (use structuredClone or lib)", penalty: 2 },
    { pattern: /document\.querySelector.*(?:for|while|forEach)/gs, msg: "DOM queries inside loops", penalty: 4 },
    { pattern: /SELECT\s+\*/gi, msg: "SELECT * queries (specify columns)", penalty: 2 },
    { pattern: /sleep\s*\(\s*\d+\s*\)|time\.sleep|Thread\.sleep/g, msg: "Blocking sleep calls", penalty: 3 },
    { pattern: /\.sort\(\).*\.sort\(\)|sorted\(.*sorted\(/gs, msg: "Redundant sorting operations", penalty: 3 },
  ];

  inefficientPatterns.forEach(({ pattern, msg, penalty }) => {
    if (pattern.test(content)) {
      score -= penalty;
      findings.push({ type: "info", msg });
    }
  });

  // 5. Good patterns
  const goodPerfPatterns = [
    { pattern: /\bSet\b|\bHashSet\b|\bHashMap\b|\bdict\b|\bunordered_map\b/, msg: "Uses hash-based data structures" },
    { pattern: /async\s+|await\s+|Promise|Future|goroutine|spawn/, msg: "Async/concurrent patterns" },
    { pattern: /lazy|generator|yield|Iterator|stream\(\)/, msg: "Lazy evaluation patterns" },
    { pattern: /binary.?search|bisect|lower_bound/, msg: "Binary search usage" },
  ];

  goodPerfPatterns.forEach(({ pattern, msg }) => {
    if (pattern.test(content)) {
      findings.push({ type: "good", msg });
    }
  });

  return { score: Math.max(0, score), findings, category: "Runtime Performance", maxScore: 30 };
}

// Memory Management Metrics (30 pts)
function analyzeMemory(content, filename) {
  const lines = content.split("\n");
  let score = 30;
  let findings = [];

  // 1. Large allocations in loops
  const allocInLoop = /(?:for|while)[^{]*\{[^}]*(?:new\s+\w+\[|malloc|calloc|new\s+Array|new\s+Map|new\s+Set|\[\]\s*=|list\(\)|dict\(\))/gs;
  if (allocInLoop.test(content)) {
    score -= 6;
    findings.push({ type: "warning", msg: "Object allocation inside loops" });
  }

  // 2. Resource cleanup
  const opensResource = /open\(|fopen|createReadStream|new\s+(?:File|Stream|Connection|Socket)|connect\(|\.cursor\(\)/;
  const closesResource = /\.close\(|\.dispose\(|\.release\(|\.end\(|\.destroy\(|finally|with\s+open|using\s|defer\s|try-with-resources/;
  if (opensResource.test(content) && !closesResource.test(content)) {
    score -= 6;
    findings.push({ type: "warning", msg: "Resources opened without visible cleanup" });
  } else if (opensResource.test(content) && closesResource.test(content)) {
    findings.push({ type: "good", msg: "Resource cleanup patterns present" });
  }

  // Context managers / RAII
  if (/with\s+open|using\s*\(|try-with-resources|defer\s+|RAII|unique_ptr|shared_ptr/.test(content)) {
    findings.push({ type: "good", msg: "Uses RAII/context managers for resource safety" });
  }

  // 3. Global mutable state
  const globalMutable = content.match(/^(?:var|let)\s+\w+\s*=\s*(?:\[|\{|new\s)/gm) || [];
  if (globalMutable.length > 5) {
    score -= 4;
    findings.push({ type: "warning", msg: `${globalMutable.length} global mutable variables` });
  }

  // 4. Memory leak patterns
  const leakPatterns = [
    { pattern: /addEventListener(?!.*removeEventListener)/gs, msg: "Event listeners without cleanup", penalty: 4 },
    { pattern: /setInterval(?!.*clearInterval)/gs, msg: "setInterval without clearInterval", penalty: 4 },
    { pattern: /setTimeout(?!.*clearTimeout).*setTimeout/gs, msg: "Multiple timeouts without cleanup", penalty: 3 },
    { pattern: /\.subscribe\((?!.*\.unsubscribe)/gs, msg: "Subscriptions without unsubscribe", penalty: 3 },
  ];

  leakPatterns.forEach(({ pattern, msg, penalty }) => {
    if (pattern.test(content)) {
      score -= penalty;
      findings.push({ type: "warning", msg });
    }
  });

  // 5. Buffer/streaming vs loading all
  const loadsAll = /readFileSync|read_to_string|readAll|\.read\(\)\s*$|slurp|file_get_contents/m;
  const usesStream = /createReadStream|BufferedReader|StreamReader|io\.Reader|BufRead|chunk|pipe\(/;
  if (loadsAll.test(content) && !usesStream.test(content)) {
    score -= 3;
    findings.push({ type: "info", msg: "Reads entire files into memory (consider streaming)" });
  } else if (usesStream.test(content)) {
    findings.push({ type: "good", msg: "Uses streaming/buffered I/O" });
  }

  // 6. Caching patterns
  if (/cache|LRU|memoize|WeakMap|WeakRef|lru_cache|@cache/.test(content)) {
    findings.push({ type: "good", msg: "Caching/memoization patterns" });
  }

  // 7. Unnecessary copies
  if (/\.slice\(\)|\.map\(.*=>.*\)\.map\(|\.filter\(.*\)\.map\(.*\)\.filter\(|spread.*spread|\.concat\(.*\.concat\(/.test(content)) {
    score -= 2;
    findings.push({ type: "info", msg: "Potential unnecessary data copies (chained transforms)" });
  }

  return { score: Math.max(0, score), findings, category: "Memory Management", maxScore: 30 };
}

function analyzeFile(content, filename) {
  const quality = analyzeCodeQuality(content, filename);
  const performance = analyzePerformance(content, filename);
  const memory = analyzeMemory(content, filename);
  return {
    filename,
    totalScore: quality.score + performance.score + memory.score,
    categories: [quality, performance, memory],
    lineCount: content.split("\n").length,
  };
}

// ─── GitHub API Helpers ───────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 403) throw new Error("GitHub API rate limit reached. Try again later.");
    if (res.status === 404) throw new Error("User not found.");
    throw new Error(`GitHub API error: ${res.status}`);
  }
  return res.json();
}

async function fetchFileContent(url) {
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  if (data.encoding === "base64" && data.content) {
    return atob(data.content.replace(/\n/g, ""));
  }
  return null;
}

async function getRepoFiles(owner, repo, path = "", depth = 0) {
  if (depth > 2) return [];
  try {
    const items = await fetchJSON(`${GITHUB_API}/repos/${owner}/${repo}/contents/${path}`);
    if (!Array.isArray(items)) return [];
    let files = [];
    for (const item of items) {
      if (item.type === "file" && isAnalyzable(item.name) && item.size < MAX_FILE_SIZE) {
        files.push({ name: item.path, url: item.url, size: item.size });
      } else if (item.type === "dir" && !item.name.startsWith(".") && !["node_modules","vendor","dist","build","__pycache__","venv",".git","target","bin","obj"].includes(item.name)) {
        const subFiles = await getRepoFiles(owner, repo, item.path, depth + 1);
        files = files.concat(subFiles);
      }
      if (files.length >= MAX_FILES_PER_REPO) break;
    }
    return files.slice(0, MAX_FILES_PER_REPO);
  } catch {
    return [];
  }
}

// ─── Gauge Component ──────────────────────────────────────────────────────────

function ScoreGauge({ score, size = 180 }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current) return;
    const svg = d3.select(ref.current);
    svg.selectAll("*").remove();
    const w = size, h = size;
    const g = svg.attr("width", w).attr("height", h).append("g").attr("transform", `translate(${w/2},${h/2 + 10})`);
    const radius = w * 0.38;
    const arc = d3.arc().innerRadius(radius - 14).outerRadius(radius).cornerRadius(7);

    // Background arc
    g.append("path")
      .datum({ startAngle: -Math.PI * 0.75, endAngle: Math.PI * 0.75 })
      .attr("d", arc)
      .attr("fill", "#1e293b");

    // Score arc
    const scoreAngle = -Math.PI * 0.75 + (Math.PI * 1.5) * (score / 100);
    const color = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : score >= 25 ? "#f97316" : "#ef4444";
    g.append("path")
      .datum({ startAngle: -Math.PI * 0.75, endAngle: -Math.PI * 0.75 })
      .attr("d", arc)
      .attr("fill", color)
      .transition()
      .duration(1200)
      .ease(d3.easeCubicOut)
      .attrTween("d", function() {
        const interp = d3.interpolate(-Math.PI * 0.75, scoreAngle);
        return (t) => arc({ startAngle: -Math.PI * 0.75, endAngle: interp(t) });
      });

    // Score text
    const text = g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.1em")
      .attr("fill", "#f1f5f9")
      .attr("font-size", `${size * 0.22}px`)
      .attr("font-weight", "700")
      .text("0");

    text.transition().duration(1200).ease(d3.easeCubicOut)
      .tween("text", function() {
        const interp = d3.interpolateRound(0, score);
        return (t) => { this.textContent = interp(t); };
      });

    g.append("text")
      .attr("text-anchor", "middle")
      .attr("dy", `${size * 0.15}px`)
      .attr("fill", "#94a3b8")
      .attr("font-size", "12px")
      .text("/ 100");

  }, [score, size]);
  return <svg ref={ref} />;
}

// ─── Category Bar ─────────────────────────────────────────────────────────────

function CategoryBar({ label, score, max, icon }) {
  const pct = (score / max) * 100;
  const color = pct >= 75 ? "#10b981" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#f97316" : "#ef4444";
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 13, color: "#cbd5e1" }}>
        <span>{icon} {label}</span>
        <span style={{ fontWeight: 600, color }}>{score} / {max}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: "#1e293b", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, transition: "width 1s ease" }} />
      </div>
    </div>
  );
}

// ─── Finding Badge ────────────────────────────────────────────────────────────

function Finding({ type, msg }) {
  const styles = {
    warning: { bg: "rgba(239,68,68,0.12)", border: "#ef4444", color: "#fca5a5", icon: "⚠" },
    info: { bg: "rgba(59,130,246,0.12)", border: "#3b82f6", color: "#93c5fd", icon: "ℹ" },
    good: { bg: "rgba(16,185,129,0.12)", border: "#10b981", color: "#6ee7b7", icon: "✓" },
  };
  const s = styles[type] || styles.info;
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 6, fontSize: 12, background: s.bg, border: `1px solid ${s.border}30`, color: s.color, margin: "2px 4px 2px 0" }}>
      <span>{s.icon}</span>{msg}
    </div>
  );
}

// ─── File Result Card ─────────────────────────────────────────────────────────

function FileCard({ result, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen || false);
  const pct = result.totalScore;
  const color = pct >= 75 ? "#10b981" : pct >= 50 ? "#f59e0b" : pct >= 25 ? "#f97316" : "#ef4444";
  return (
    <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, marginBottom: 10, overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 16px", cursor: "pointer", userSelect: "none" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#64748b", fontSize: 11, transform: open ? "rotate(90deg)" : "none", transition: "transform .2s" }}>▶</span>
          <span style={{ fontFamily: "monospace", fontSize: 13, color: "#e2e8f0" }}>{result.filename}</span>
          <span style={{ fontSize: 11, color: "#64748b" }}>{result.lineCount} lines</span>
        </div>
        <span style={{ fontWeight: 700, fontSize: 15, color }}>{pct}</span>
      </div>
      {open && (
        <div style={{ padding: "0 16px 14px", borderTop: "1px solid #1e293b" }}>
          {result.categories.map((cat, i) => (
            <div key={i} style={{ marginTop: 12 }}>
              <CategoryBar label={cat.category} score={cat.score} max={cat.maxScore} icon={["✦","⚡","🧠"][i]} />
              <div style={{ display: "flex", flexWrap: "wrap", marginTop: 4 }}>
                {cat.findings.map((f, j) => <Finding key={j} type={f.type} msg={f.msg} />)}
                {cat.findings.length === 0 && <span style={{ fontSize: 12, color: "#475569" }}>No notable findings</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [username, setUsername] = useState("");
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [results, setResults] = useState(null);

  const analyze = useCallback(async () => {
    const user = username.trim();
    if (!user) return;
    setLoading(true);
    setError("");
    setResults(null);
    setProgress("Fetching user profile...");

    try {
      const profile = await fetchJSON(`${GITHUB_API}/users/${user}`);
      setProgress("Fetching repositories...");
      let repos = await fetchJSON(`${GITHUB_API}/users/${user}/repos?sort=updated&per_page=30`);
      // Filter forks and pick most active
      repos = repos.filter((r) => !r.fork).sort((a, b) => (b.stargazers_count + b.size) - (a.stargazers_count + a.size)).slice(0, MAX_REPOS);

      if (repos.length === 0) {
        setError("No public non-fork repositories found for this user.");
        setLoading(false);
        return;
      }

      let allFileResults = [];
      let repoSummaries = [];

      for (let ri = 0; ri < repos.length; ri++) {
        const repo = repos[ri];
        setProgress(`Analyzing ${repo.name} (${ri + 1}/${repos.length})...`);
        const files = await getRepoFiles(user, repo.name);
        let repoResults = [];

        for (const file of files) {
          const content = await fetchFileContent(file.url);
          if (content && content.length > 20) {
            const result = analyzeFile(content, file.name);
            repoResults.push(result);
            allFileResults.push({ ...result, repo: repo.name });
          }
        }

        if (repoResults.length > 0) {
          const avg = Math.round(repoResults.reduce((s, r) => s + r.totalScore, 0) / repoResults.length);
          repoSummaries.push({ name: repo.name, score: avg, stars: repo.stargazers_count, files: repoResults.length, language: repo.language });
        }
      }

      if (allFileResults.length === 0) {
        setError("No analyzable source files found in this user's repositories.");
        setLoading(false);
        return;
      }

      const overallScore = Math.round(allFileResults.reduce((s, r) => s + r.totalScore, 0) / allFileResults.length);
      const catAvgs = [0, 1, 2].map((i) => {
        const scores = allFileResults.map((r) => r.categories[i].score);
        return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
      });

      // Aggregate findings
      const findingCounts = { warning: 0, info: 0, good: 0 };
      allFileResults.forEach((r) => r.categories.forEach((c) => c.findings.forEach((f) => findingCounts[f.type]++)));

      // Top issues
      const issueFreq = {};
      allFileResults.forEach((r) => r.categories.forEach((c) => c.findings.filter((f) => f.type !== "good").forEach((f) => {
        issueFreq[f.msg] = (issueFreq[f.msg] || 0) + 1;
      })));
      const topIssues = Object.entries(issueFreq).sort((a, b) => b[1] - a[1]).slice(0, 5);

      setResults({
        profile,
        overallScore,
        catAvgs,
        repoSummaries: repoSummaries.sort((a, b) => b.score - a.score),
        fileResults: allFileResults.sort((a, b) => a.totalScore - b.totalScore),
        findingCounts,
        topIssues,
        filesAnalyzed: allFileResults.length,
        reposAnalyzed: repoSummaries.length,
      });
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [username]);

  const grade = (s) => s >= 90 ? "A+" : s >= 80 ? "A" : s >= 70 ? "B+" : s >= 60 ? "B" : s >= 50 ? "C" : s >= 40 ? "D" : "F";

  return (
    <div style={{ minHeight: "100vh", background: "#020617", color: "#e2e8f0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid #1e293b", padding: "20px 0" }}>
        <div style={{ maxWidth: 900, margin: "0 auto", padding: "0 24px" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0, letterSpacing: "-0.5px" }}>
            <span style={{ color: "#6366f1" }}>◆</span> GitHub Code Analyzer
          </h1>
          <p style={{ color: "#64748b", fontSize: 13, margin: "4px 0 0" }}>
            Static analysis of public repositories — Code Quality · Performance · Memory
          </p>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
        {/* Search */}
        <div style={{ display: "flex", gap: 10, marginBottom: 32 }}>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !loading && analyze()}
            placeholder="Enter GitHub username..."
            style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0", fontSize: 15, outline: "none" }}
          />
          <button
            onClick={analyze}
            disabled={loading || !username.trim()}
            style={{ padding: "12px 28px", borderRadius: 10, border: "none", background: loading ? "#334155" : "#6366f1", color: "#fff", fontSize: 15, fontWeight: 600, cursor: loading ? "wait" : "pointer", opacity: !username.trim() ? 0.5 : 1 }}
          >
            {loading ? "Analyzing..." : "Analyze"}
          </button>
        </div>

        {/* Progress */}
        {loading && (
          <div style={{ textAlign: "center", padding: 40 }}>
            <div style={{ width: 40, height: 40, border: "3px solid #1e293b", borderTop: "3px solid #6366f1", borderRadius: "50%", animation: "spin 1s linear infinite", margin: "0 auto 16px" }} />
            <p style={{ color: "#94a3b8", fontSize: 14 }}>{progress}</p>
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={{ padding: "14px 18px", borderRadius: 10, background: "rgba(239,68,68,0.1)", border: "1px solid #ef444440", color: "#fca5a5", fontSize: 14 }}>
            {error}
          </div>
        )}

        {/* Results */}
        {results && (
          <div>
            {/* Profile + Score */}
            <div style={{ display: "flex", gap: 32, alignItems: "center", background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 28, marginBottom: 24 }}>
              <div style={{ textAlign: "center" }}>
                <img src={results.profile.avatar_url} style={{ width: 72, height: 72, borderRadius: "50%", border: "2px solid #334155" }} />
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{results.profile.name || results.profile.login}</div>
                  <div style={{ color: "#64748b", fontSize: 13 }}>@{results.profile.login}</div>
                </div>
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                  <ScoreGauge score={results.overallScore} size={160} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, color: "#94a3b8", marginBottom: 4 }}>
                      Grade: <span style={{ fontSize: 22, fontWeight: 800, color: results.overallScore >= 70 ? "#10b981" : results.overallScore >= 50 ? "#f59e0b" : "#ef4444" }}>{grade(results.overallScore)}</span>
                    </div>
                    <CategoryBar label="Code Quality" score={results.catAvgs[0]} max={40} icon="✦" />
                    <CategoryBar label="Runtime Performance" score={results.catAvgs[1]} max={30} icon="⚡" />
                    <CategoryBar label="Memory Management" score={results.catAvgs[2]} max={30} icon="🧠" />
                  </div>
                </div>
              </div>
            </div>

            {/* Stats row */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 24 }}>
              {[
                { label: "Repos Analyzed", value: results.reposAnalyzed, color: "#6366f1" },
                { label: "Files Analyzed", value: results.filesAnalyzed, color: "#8b5cf6" },
                { label: "Issues Found", value: results.findingCounts.warning + results.findingCounts.info, color: "#f59e0b" },
                { label: "Good Patterns", value: results.findingCounts.good, color: "#10b981" },
              ].map((s, i) => (
                <div key={i} style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 10, padding: 16, textAlign: "center" }}>
                  <div style={{ fontSize: 26, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Top Issues */}
            {results.topIssues.length > 0 && (
              <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 20, marginBottom: 24 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 12px", color: "#f1f5f9" }}>Top Issues Across Codebase</h3>
                {results.topIssues.map(([msg, count], i) => (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < results.topIssues.length - 1 ? "1px solid #1e293b" : "none" }}>
                    <span style={{ fontSize: 13, color: "#cbd5e1" }}>{msg}</span>
                    <span style={{ fontSize: 12, color: "#64748b", background: "#1e293b", padding: "2px 10px", borderRadius: 10, fontWeight: 600 }}>{count}x</span>
                  </div>
                ))}
              </div>
            )}

            {/* Repo Breakdown */}
            <div style={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 14, padding: 20, marginBottom: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 14px", color: "#f1f5f9" }}>Repository Scores</h3>
              {results.repoSummaries.map((repo, i) => {
                const c = repo.score >= 75 ? "#10b981" : repo.score >= 50 ? "#f59e0b" : repo.score >= 25 ? "#f97316" : "#ef4444";
                return (
                  <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: i < results.repoSummaries.length - 1 ? "1px solid #1e293b" : "none" }}>
                    <div>
                      <span style={{ fontWeight: 600, fontSize: 14 }}>{repo.name}</span>
                      <span style={{ fontSize: 12, color: "#64748b", marginLeft: 10 }}>{repo.language || "—"}</span>
                      <span style={{ fontSize: 12, color: "#64748b", marginLeft: 10 }}>★ {repo.stars}</span>
                      <span style={{ fontSize: 12, color: "#64748b", marginLeft: 10 }}>{repo.files} files</span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <div style={{ width: 100, height: 6, borderRadius: 3, background: "#1e293b", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${repo.score}%`, background: c, borderRadius: 3 }} />
                      </div>
                      <span style={{ fontWeight: 700, fontSize: 14, color: c, minWidth: 28, textAlign: "right" }}>{repo.score}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* File Details */}
            <div style={{ marginBottom: 24 }}>
              <h3 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 14px", color: "#f1f5f9" }}>
                File-Level Analysis <span style={{ fontWeight: 400, color: "#64748b", fontSize: 13 }}>({results.fileResults.length} files, sorted by score)</span>
              </h3>
              {results.fileResults.map((r, i) => (
                <FileCard key={i} result={r} defaultOpen={i < 3} />
              ))}
            </div>

            {/* Methodology note */}
            <div style={{ textAlign: "center", padding: 20, color: "#475569", fontSize: 12, borderTop: "1px solid #1e293b" }}>
              Scores based on static heuristic analysis of public source code. Analyzes up to {MAX_REPOS} repos and {MAX_FILES_PER_REPO} files per repo.
              <br />Results are indicative — not a substitute for manual code review.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}