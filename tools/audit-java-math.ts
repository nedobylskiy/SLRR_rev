import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseSource, type Expr, type Stmt } from 'slrr-jvm-compiler';

const root = process.argv[2] ?? 'C:/Program Files (x86)/Steam/steamapps/common/Street Legal Racing Redline/sl/Scripts';
const calls = new Map<string, { count: number; example: string }>();
const fields = new Map<string, { count: number; example: string }>();

async function* javaFiles(directory: string): AsyncGenerator<string> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* javaFiles(path);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.java')) yield path;
  }
}

function record(map: typeof calls, key: string, path: string, line: number) {
  const previous = map.get(key);
  map.set(key, { count: (previous?.count ?? 0) + 1, example: previous?.example ?? `${path}:${line}` });
}

function walkExpr(expr: Expr | undefined, path: string): void {
  if (!expr) return;
  const member = expr.kind === 'call' ? expr.left : expr;
  if (member?.kind === 'member' && member.left?.kind === 'name' && member.left.text === 'Math') {
    if (expr.kind === 'call') record(calls, `${member.text}/${expr.args?.length ?? 0}`, path, expr.token.line);
    else record(fields, member.text!, path, expr.token.line);
  }
  if (!(expr.kind === 'call' && member?.kind === 'member' && member.left?.kind === 'name' && member.left.text === 'Math'))
    walkExpr(expr.left, path);
  walkExpr(expr.right, path); walkExpr(expr.third, path);
  for (const arg of expr.args ?? []) walkExpr(arg, path);
}

function walkStmt(stmt: Stmt | undefined, path: string): void {
  if (!stmt) return;
  walkExpr(stmt.expr, path);
  for (const declaration of stmt.declarations ?? []) walkExpr(declaration.initial, path);
  walkStmt(stmt.body, path); walkStmt(stmt.elseBody, path); walkStmt(stmt.init, path);
  for (const child of stmt.items ?? []) walkStmt(child, path);
  for (const update of stmt.update ?? []) walkExpr(update, path);
  for (const entry of stmt.cases ?? []) {
    walkExpr(entry.value, path);
    for (const child of entry.items) walkStmt(child, path);
  }
}

for await (const path of javaFiles(root)) {
  const source = await readFile(path, 'utf8');
  const program = parseSource(source);
  for (const cls of program.classes) for (const member of cls.members) {
    if (member.kind === 'field') walkExpr(member.initial, path);
    else walkStmt(member.body, path);
  }
}
for (const [kind, map] of [['call', calls], ['field', fields]] as const)
  for (const [name, detail] of [...map].sort(([a], [b]) => a.localeCompare(b)))
    process.stdout.write(`${kind}\t${name}\t${detail.count}\t${detail.example}\n`);
