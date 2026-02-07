import {createHash} from "crypto";
import {initializeApp} from "firebase-admin/app";
import {getFirestore} from "firebase-admin/firestore";
import {getStorage} from "firebase-admin/storage";
import {setGlobalOptions} from "firebase-functions/v2";
import {onObjectFinalized} from "firebase-functions/v2/storage";
import * as logger from "firebase-functions/logger";

initializeApp();
setGlobalOptions({maxInstances: 10});

const RAW_CSV_PREFIX = (process.env.LOCATION_RAW_CSV_PREFIX ?? "raw-csv/").replace(/^\/+/, "");

type SourceType = "country_region" | "city";

type CsvRow = Record<string, string>;

const splitCsvRecords = (text: string): string[][] => {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        value += "\"";
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      row.push(value.trim());
      value = "";
      continue;
    }
    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(value.trim());
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      value = "";
      continue;
    }
    value += ch;
  }

  if (value.length || row.length) {
    row.push(value.trim());
    if (row.some((cell) => cell.length > 0)) rows.push(row);
  }
  return rows;
};

const parseCsv = (text: string): CsvRow[] => {
  const records = splitCsvRecords(text);
  if (!records.length) return [];
  const headers = records[0].map((h) => h.replace(/^\uFEFF/, "").trim());
  const rows = records.slice(1);
  return rows
    .filter((row) => row.some((cell) => cell.trim().length > 0))
    .map((row) => {
      const mapped: CsvRow = {};
      headers.forEach((header, idx) => {
        mapped[header] = String(row[idx] ?? "").trim();
      });
      return mapped;
    });
};

const normalizeToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

const buildLocationId = (name: string, address: string): string => {
  const base = `${name}|${address}`.trim().toLowerCase();
  const hash = createHash("sha1").update(base).digest("hex").slice(0, 10);
  const slug = normalizeToken(`${name}-${address}`) || "location";
  return `${slug}-${hash}`;
};

const detectSourceType = (fileName: string): SourceType | null => {
  const lower = fileName.toLowerCase();
  if (lower.includes("countries_and_regions")) return "country_region";
  if (lower.includes("cities")) return "city";
  return null;
};

const parseNum = (value: string): number | null => {
  if (!value) return null;
  const numeric = Number(value.replace(/,/g, ""));
  return Number.isFinite(numeric) ? numeric : null;
};

const toLocationDoc = (row: CsvRow, sourceType: SourceType, sourceFile: string) => {
  const name = String(row["Name"] ?? "").trim();
  const address = String(row["Address"] ?? "").trim();
  const id = buildLocationId(name, address);
  const keywords = [row["Keyword 1"], row["Keyword 2"], row["Keyword 3"]]
    .map((keyword) => String(keyword ?? "").trim())
    .filter(Boolean);
  const sourceRowHash = createHash("sha1")
    .update(
      JSON.stringify({
        sourceType,
        name,
        address,
        visitorCount: row["Visitor Count"] ?? "",
        climate: row["Climate"] ?? "",
        priceLevel: row["Price Level"] ?? "",
        bestMonth: row["Best Month"] ?? "",
        editorialSummary: row["Editorial Summary"] ?? "",
        popularityTier: row["Popularity Tier"] ?? "",
        unesco: row["UNESCO"] ?? "",
        rating: row["Rating"] ?? "",
        userRatingCount: row["userRatingCount"] ?? "",
        websiteUri: row["websiteUri"] ?? "",
        googleMapsUri: row["googleMapsUri"] ?? "",
        keywords,
      })
    )
    .digest("hex");

  return {
    id,
    sourceType,
    category: String(row["Category"] ?? "").trim() || null,
    name,
    address: address || null,
    searchName: `${name} ${address}`.trim().toLowerCase(),
    visitorCount: String(row["Visitor Count"] ?? "").trim() || null,
    climate: String(row["Climate"] ?? "").trim() || null,
    priceLevel: String(row["Price Level"] ?? "").trim() || null,
    bestMonth: String(row["Best Month"] ?? "").trim() || null,
    editorialSummary: String(row["Editorial Summary"] ?? "").trim() || null,
    popularityTier: String(row["Popularity Tier"] ?? "").trim() || null,
    unesco: String(row["UNESCO"] ?? "").trim() || null,
    rating: parseNum(String(row["Rating"] ?? "").trim()),
    userRatingCount: parseNum(String(row["userRatingCount"] ?? "").trim()),
    websiteUri: String(row["websiteUri"] ?? "").trim() || null,
    googleMapsUri: String(row["googleMapsUri"] ?? "").trim() || null,
    keywords,
    sourceFile,
    sourceRowHash,
    updatedAt: new Date().toISOString(),
  };
};

const chunked = <T>(items: T[], size = 400): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
};

export const onLocationCsvChanged = onObjectFinalized(
  {timeoutSeconds: 540, memory: "512MiB"},
  async (event) => {
    const object = event.data;
  const filePath = object.name ?? "";
  const bucketName = object.bucket;
  if (!filePath || !bucketName) return;
  if (!filePath.startsWith(RAW_CSV_PREFIX) || !filePath.toLowerCase().endsWith(".csv")) return;

  const fileName = filePath.split("/").pop() ?? filePath;
  const sourceType = detectSourceType(fileName);
  if (!sourceType) {
    logger.info(`Skipping unsupported raw csv: ${filePath}`);
    return;
  }

  logger.info(`Processing location csv ${filePath}`);
  const [buffer] = await getStorage().bucket(bucketName).file(filePath).download();
  const rows = parseCsv(buffer.toString("utf8"));
  const docs = rows
    .map((row) => toLocationDoc(row, sourceType, filePath))
    .filter((doc) => doc.name.length > 0);

  const db = getFirestore();
  const ids = new Set(docs.map((doc) => doc.id));
  for (const batchDocs of chunked(docs)) {
    const batch = db.batch();
    for (const doc of batchDocs) {
      batch.set(db.collection("locations").doc(doc.id), doc, {merge: true});
    }
    await batch.commit();
  }

  const existing = await db.collection("locations").where("sourceFile", "==", filePath).get();
  const stale = existing.docs.filter((doc) => !ids.has(doc.id));
  for (const staleChunk of chunked(stale)) {
    const batch = db.batch();
    staleChunk.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }

  logger.info(`Processed ${docs.length} location rows from ${filePath}. Removed ${stale.length} stale docs.`);
});
