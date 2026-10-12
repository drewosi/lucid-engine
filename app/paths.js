/* ============ PATH CLASSIFIERS (pure) ============
   Name/path regexes and package detection shared by the main thread and the
   indexing worker. No DOM, no app state: everything arrives as an argument. */
var CONFIG_NAMES = /^(package\.json|tsconfig[^\/]*\.json|jsconfig\.json|pyproject\.toml|setup\.(py|cfg)|pipfile|go\.(mod|sum)|cargo\.toml|gemfile|mix\.exs|makefile|justfile|dockerfile|docker-compose\.ya?ml|\.env\.example|vite\.config\.[jt]s|webpack\.config\.[jt]s|next\.config\.[jt]s|rollup\.config\.[jt]s|requirements\.txt|composer\.json|build\.gradle(\.kts)?|pom\.xml|[^\/]+\.csproj|[^\/]+\.sln|cmakelists\.txt)$/i;
var ENTRY_NAMES = /^(index|main|__main__|app|server|cli|core|__init__|mod|lib|program|application)\.[a-z]+$/i;
var README_NAMES = /^readme(\.|$)/i;
/* test detection across ecosystems: JS/TS .test/.spec, Go/py _test., Ruby _spec.,
   Python test_*.py prefix, tests/ or spec/ directories, Java FooTest / C# FooTests */
var TEST_PATH = /(\.test\.|\.spec\.|_test\.|_spec\.|\/test_[^\/]*\.py$|\btests?\/|\bspec\/|\b__tests__\b|tests?\.(java|cs|kt|swift|php)$)/i;

var DOCS_PATH = /(^|\/)docs?\//i;

/* monorepo awareness: a "package" is any directory holding a build manifest */
var MANIFEST_RE = /^(package\.json|cargo\.toml|pyproject\.toml|go\.mod|composer\.json|build\.gradle(\.kts)?|pom\.xml|gemfile|mix\.exs|[^\/]+\.csproj)$/i;
function detectPackages(paths, files) {
  var byDir = {};
  paths.forEach(function (p) {
    var name = p.slice(p.lastIndexOf('/') + 1);
    if (!MANIFEST_RE.test(name)) return;
    var dir = p.indexOf('/') === -1 ? '.' : p.slice(0, p.lastIndexOf('/'));
    if (byDir[dir]) return; /* one manifest per dir is enough */
    var label = '', f = files.get(p), m;
    if (f) {
      if (/(package|composer)\.json$/i.test(name)) { m = f.content.match(/"name"\s*:\s*"([^"]+)"/); if (m) label = m[1]; }
      else if (/\.(toml)$/i.test(name)) { m = f.content.match(/^\s*name\s*=\s*["']([^"']+)["']/m); if (m) label = m[1]; }
      else if (/go\.mod$/i.test(name)) { m = f.content.match(/^module\s+(\S+)/m); if (m) label = m[1]; }
      else if (/pom\.xml$/i.test(name)) { m = f.content.match(/<artifactId>([^<]+)<\/artifactId>/); if (m) label = m[1]; }
      else if (/mix\.exs$/i.test(name)) { m = f.content.match(/app:\s*:(\w+)/); if (m) label = m[1]; }
      else if (/\.csproj$/i.test(name)) { label = name.replace(/\.csproj$/i, ''); }
    }
    byDir[dir] = { dir: dir, manifest: p, name: label };
  });
  return Object.keys(byDir).sort().map(function (d) { return byDir[d]; });
}

export { CONFIG_NAMES, DOCS_PATH, ENTRY_NAMES, MANIFEST_RE, README_NAMES, TEST_PATH, detectPackages };
