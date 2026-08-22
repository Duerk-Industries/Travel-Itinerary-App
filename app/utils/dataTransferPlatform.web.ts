export type PickedCsv = { name: string; size: number; text: string };

export const pickCsvFile = (): Promise<PickedCsv | null> => new Promise((resolve, reject) => {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.csv,text/csv,text/comma-separated-values,application/csv';
  input.onchange = async () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) { resolve(null); return; }
    if (file.size > 2 * 1024 * 1024) { reject(new Error('CSV file exceeds the 2 MiB limit.')); return; }
    try { resolve({ name: file.name, size: file.size, text: await file.text() }); } catch { reject(new Error('Unable to read the selected CSV file.')); }
  };
  input.click();
});

export const shareCsvFile = async (filename: string, text: string): Promise<void> => {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
};
