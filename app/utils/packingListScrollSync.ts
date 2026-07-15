export type PackingListScrollSyncTargets = {
  horizontalHeader: (x: number) => void;
  horizontalBody: (x: number) => void;
  verticalLabels: (y: number) => void;
  verticalBody: (y: number) => void;
};

/** Small stateful controller kept outside React so scroll events never cause a render. */
export const createPackingListScrollSync = (targets: PackingListScrollSyncTargets) => {
  let xOffset = 0;
  let yOffset = 0;
  return {
    syncX(nextX: number) {
      if (!Number.isFinite(nextX) || Math.abs(nextX - xOffset) < 1) return;
      xOffset = Math.max(0, nextX);
      targets.horizontalHeader(xOffset);
      targets.horizontalBody(xOffset);
    },
    syncY(nextY: number) {
      if (!Number.isFinite(nextY) || Math.abs(nextY - yOffset) < 1) return;
      yOffset = Math.max(0, nextY);
      targets.verticalLabels(yOffset);
      targets.verticalBody(yOffset);
    },
    getOffsets: () => ({ x: xOffset, y: yOffset }),
  };
};
