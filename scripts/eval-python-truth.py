"""Ground truth for scripts/eval-index.mjs (Python): imports and top-level names via the stdlib ast module.

Usage: python eval-python-truth.py <file-list.json>   (a JSON array of absolute paths)
Prints a JSON object {path: {"imports": [...], "top": [...]}}. Files that do not parse are omitted.
Import specifiers use the same shape the indexer records: dotted module, with leading dots
for relative imports ("from ..pkg import x" -> "..pkg", "from . import x" -> ".").
"""
import ast
import json
import sys


def targets(node):
    if isinstance(node, ast.Name):
        yield node.id
    elif isinstance(node, (ast.Tuple, ast.List)):
        for e in node.elts:
            yield from targets(e)


def main():
    out = {}
    for path in json.load(open(sys.argv[1], encoding="utf8")):
        try:
            src = open(path, encoding="utf8", errors="replace").read()
            tree = ast.parse(src)
        except Exception:
            continue
        imports, top = [], []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imports.extend(a.name for a in node.names)
            elif isinstance(node, ast.ImportFrom):
                imports.append("." * node.level + (node.module or ""))
        for node in tree.body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                top.append(node.name)
            elif isinstance(node, ast.Assign):
                for t in node.targets:
                    top.extend(targets(t))
            elif isinstance(node, ast.AnnAssign):
                top.extend(targets(node.target))
        out[path] = {"imports": imports, "top": top}
    json.dump(out, sys.stdout)


main()
