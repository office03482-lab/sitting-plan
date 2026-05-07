import fs from 'fs';
import ts from 'typescript';
const text = fs.readFileSync('src/pages/StudentManagement.tsx', 'utf8');
const source = ts.createSourceFile('StudentManagement.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const diagnostics = source.parseDiagnostics;
if (diagnostics.length === 0) {
  console.log('no diagnostics');
} else {
  diagnostics.forEach(d => {
    const { line, character } = source.getLineAndCharacterOfPosition(d.start);
    const pos = d.start;
    const snippet = text.slice(Math.max(0, pos - 40), Math.min(text.length, pos + 40));
    console.log(`${line+1}:${character+1} ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
    console.log('---snippet---');
    console.log(JSON.stringify(snippet));
  });
  process.exit(1);
}
