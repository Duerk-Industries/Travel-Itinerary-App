/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const root = path.resolve(__dirname, '..');
const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(dir, entry.name);
  return entry.isDirectory() ? sources(file) : file.endsWith('.tsx') ? [file] : [];
});

it('keeps UI icon geometry in Icon and renders UI emoji through IconText', () => {
  const violations: string[] = [];
  for (const file of [...sources(path.join(root, 'components')), ...sources(path.join(root, 'tabs')), path.join(root, 'App.tsx')]) {
    // Provider logos retain their brand artwork.
    if (['Icon.tsx', 'AppleLogo.tsx', 'GoogleLogo.tsx'].includes(path.basename(file))) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        if (['Svg', 'Path', 'Circle'].includes(node.tagName.getText(source))) violations.push(`${path.relative(root, file)}: local icon artwork`);
      }
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Text') {
        const content = source.text.slice(node.openingElement.end, node.closingElement.pos);
        if (/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(content)) violations.push(`${path.relative(root, file)}: emoji in native Text`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});
