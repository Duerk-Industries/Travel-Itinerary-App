/** @jest-environment node */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import { avatarPalette, buildStyles, getAppTheme, rootErrorStyles, themeStyle } from '../theme/theme';

const appRoot = path.resolve(__dirname, '..');
const sources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
  if (entry.isDirectory()) return ['tests', 'e2e', 'theme', 'node_modules', '.expo', 'dist'].includes(entry.name) ? [] : sources(path.join(dir, entry.name));
  return /\.(tsx?|js)$/.test(entry.name) && !entry.name.includes('.config.') ? [path.join(dir, entry.name)] : [];
});
const presentationKeys = new Set('backgroundColor borderColor borderRadius borderWidth color fontFamily fontSize fontWeight margin padding opacity flex flexDirection alignItems justifyContent position textAlign textDecorationLine shadowColor boxShadow'.split(' '));

it('keeps color literals and style definitions in the central theme', () => {
  const violations: string[] = [];
  for (const file of sources(appRoot)) {
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
    const report = (node: ts.Node, reason: string) => violations.push(`${path.relative(appRoot, file)}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${reason}`);
    const inlineObjects = (node: ts.Node) => {
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'themeStyle') return;
      if (ts.isObjectLiteralExpression(node)) report(node, 'inline style override');
      else ts.forEachChild(node, inlineObjects);
    };
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteralLike(node) && (/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(node.text) || /^(?:rgba?|hsla?)\(/i.test(node.text))) report(node, 'local color literal');
      // `position` is also a data field (e.g. packing-list sort order); it only styles when set to a CSS keyword literal.
      const isPresentationProperty = (property: ts.ObjectLiteralElementLike) => {
        if (!property.name) return false;
        const name = property.name.getText(source).replace(/['"]/g, '');
        if (!presentationKeys.has(name)) return false;
        return name !== 'position' || (ts.isPropertyAssignment(property) && ts.isStringLiteralLike(property.initializer));
      };
      if (ts.isObjectLiteralExpression(node) && node.properties.some(isPresentationProperty)) {
        let parent: ts.Node | undefined = node.parent;
        while (parent && !(ts.isCallExpression(parent) && parent.expression.getText(source) === 'themeStyle')) parent = parent.parent;
        if (!parent) report(node, 'local presentation definition');
      }
      if (ts.isJsxAttribute(node) && /style$/i.test(node.name.getText(source)) && node.initializer) inlineObjects(node.initializer);
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'StyleSheet.create' && node.arguments.some(ts.isObjectLiteralExpression)) report(node, 'local stylesheet definition');
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
});

const luminance = (hex: string) => hex.slice(1).match(/../g)!.map(channel => {
  const value = parseInt(channel, 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
const contrast = (a: string, b: string) => {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
};

it.each(['light', 'dark'] as const)('keeps text, actions, selection, and settlement readable in %s mode', mode => {
  const theme = getAppTheme(mode, mode);
  const { colors } = theme;
  const styles = buildStyles(theme);
  for (const background of [colors.background, colors.backgroundAlt, colors.surface, colors.surfaceMuted, colors.accentSurface]) {
    for (const foreground of [colors.text, colors.textMuted, colors.linkText]) expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
  for (const [text, background] of [
    [colors.onCta, colors.cta], [colors.onSelected, colors.selectedSurface],
    [colors.onAccent, colors.primary], [colors.onAccent, colors.dangerAction],
    [colors.onAccent, colors.successAction], [colors.onAccent, colors.warningAction],
    [colors.onAccent, colors.premiumAction], [colors.dangerText, colors.dangerSurface],
    [colors.successText, colors.successSurface], [colors.warningText, colors.warningSurface],
    [colors.premiumText, colors.premiumSurface],
  ]) expect(contrast(text, background)).toBeGreaterThanOrEqual(4.5);
  expect(styles.buttonText.color).toBe(colors.onCta);
  expect(styles.toggleOptionTextSelected.color).toBe(colors.onSelected);
  expect(themeStyle('settlementPanel', {}, theme).backgroundColor).toBe(colors.accentSurface);
  expect(colors.accentSurface).not.toBe(colors.surface);
  for (const color of avatarPalette) expect(contrast(colors.onAccent, color)).toBeGreaterThanOrEqual(4.5);
  const error = rootErrorStyles(theme);
  expect(contrast(error.title.color, error.container.backgroundColor)).toBeGreaterThanOrEqual(4.5);
});

it('provides the same token coverage in both modes and refreshes cached styles when the theme changes', () => {
  const light = getAppTheme('light', 'light');
  const dark = getAppTheme('dark', 'dark');
  expect(Object.keys(light.colors).sort()).toEqual(Object.keys(dark.colors).sort());
  expect(themeStyle('settlementPanel', {}, light)).toBe(themeStyle('settlementPanel', {}, light));
  expect(themeStyle('settlementPanel', {}, dark).backgroundColor).not.toBe(themeStyle('settlementPanel', {}, light).backgroundColor);
});
