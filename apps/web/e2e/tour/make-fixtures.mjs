// Builds the mock "Gmail" folder for the video tour (docs/video/.tour-fixtures, gitignored):
//  - NSN Update_Output.rar        the real fixture report (newest)
//  - NSN Update_Output-0600.xlsx  the same report one hour earlier, with some rows removed and
//                                 some alarm texts changed, so Compare shows new + disappeared rows
// Run: node e2e/tour/make-fixtures.mjs   (then start the `api-tour-mock` launch config)
import { copyFileSync, mkdirSync, readFileSync, rmSync, utimesSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../../..");
const require = createRequire(path.join(root, "apps/api/package.json"));
const { createExtractorFromData } = require("node-unrar-js");
const ExcelJS = require("exceljs");

const src = path.join(root, "tests/fixtures/NSN Update_Output.rar");
const out = path.join(root, "docs/video/.tour-fixtures");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const buf = readFileSync(src);
const ex = await createExtractorFromData({ data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) });
const xlsx = [...ex.extract().files].find((f) => f.fileHeader.name.toLowerCase().endsWith(".xlsx"));
const wb = new ExcelJS.Workbook();
await wb.xlsx.load(Buffer.from(xlsx.extraction));

let removed = 0;
let changed = 0;
for (const ws of wb.worksheets) {
  if (ws.name === "All") continue;
  const header = ws.getRow(1).values;
  const textCol = header.indexOf("Alarm Text");
  const suppCol = header.indexOf("Supplementary Information");
  // drop every 9th data row (bottom-up so indexes stay valid) → "new" in the later report
  for (let r = ws.rowCount; r >= 2; r--) {
    if (r % 9 === 0) {
      ws.spliceRows(r, 1);
      removed++;
    }
  }
  // change a few alarm texts → "disappeared" (and the original shows up as new)
  const col = ws.name === "Environmental" ? suppCol : textCol;
  for (let r = 3; r <= ws.rowCount && col > 0; r += 40) {
    const c = ws.getRow(r).getCell(col);
    if (c.value) {
      c.value = ws.name === "Environmental" ? "DOOR OPEN" : "BCF OPERATION DEGRADED";
      changed++;
    }
  }
}

const rarDst = path.join(out, "NSN Update_Output.rar");
const xlsxDst = path.join(out, "NSN Update_Output-0600.xlsx");
copyFileSync(src, rarDst);
await wb.xlsx.writeFile(xlsxDst);
// receivedAt = file mtime: the .xlsx is one hour older than the .rar
const t = new Date("2026-10-13T04:18:37Z");
utimesSync(rarDst, t, t);
utimesSync(xlsxDst, new Date(t.getTime() - 3600_000), new Date(t.getTime() - 3600_000));
console.log(`tour fixtures in ${out}: removed ${removed} rows, changed ${changed}`);
