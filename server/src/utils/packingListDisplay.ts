// Mirror of packages/domain/src/packingListDisplay.ts.
// Keep this inline because server tsconfig restricts cross-workspace imports.
// The domain-sync tests should compare behavior with the canonical package.
export {
  buildPackingListDisplayGroups,
  type PackingDisplayGroup,
  type PackingDisplayInputGroup,
  type PackingDisplayItem,
  type PackingDisplayKind,
} from './packingListDisplayImpl';
