import JSZip from "jszip";
import { readFile, writeFile } from "node:fs/promises";

export type ChartSpec = {
  title: string;
  kind: "line" | "col" | "bar" | "doughnut" | "pie" | "combo";
  anchor: { fromCol: number; fromRow: number; toCol: number; toRow: number };
  categories: string;
  categoryLabels: string[];
  series: Array<{ name: string; values: string; points: Array<number | null>; plot?: "bar" | "line" }>;
  /** Judul sumbu nilai (satuan), mis. "juta USD". */
  valueTitle?: string;
  /** Judul sumbu kategori, mis. "Tahun". */
  categoryTitle?: string;
  /** Format angka sumbu nilai dan label data. Default "#,##0" (tanpa desimal). */
  valueFormat?: string;
};

const SLICE_PALETTE = ["16352A", "C4622D", "1F7A4D", "A33B32", "8A6A3B", "3D6B8A", "6B4C7A", "B08968", "8D99ae"];
const OTHER_SLICE = "9A9486";

// Warna per kode HS dibuat stabil (hash kode) agar kode yang sama berwarna sama di donat ekspor dan impor.
function sliceColor(label: string): string {
  if (!label) return OTHER_SLICE;
  if (label === "Lainnya") return OTHER_SLICE;
  let hash = 0;
  for (const char of label) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return SLICE_PALETTE[hash % SLICE_PALETTE.length]!.toUpperCase();
}

function axisTitle(text: string | undefined, rotate: boolean): string {
  if (!text) return "";
  return `<c:title><c:tx><c:rich><a:bodyPr${rotate ? ' rot="-5400000" vert="horz"' : ""}/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900" b="0"/></a:pPr><a:r><a:rPr lang="id-ID" sz="900" b="0"/><a:t>${escapeXml(text)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const SERIES_COLORS: Record<string, string> = { Ekspor: "C4622D", Impor: "16352A", Neraca: "1F7A4D" };

function seriesColor(name: string, index: number): string {
  return SERIES_COLORS[name] ?? SLICE_PALETTE[index % SLICE_PALETTE.length]!;
}

type SeriesKind = "bar" | "line" | "doughnut";

function seriesXml(series: ChartSpec["series"][number], index: number, spec: ChartSpec, kind: SeriesKind): string {
  const labels = spec.categoryLabels;
  const cats = labels
    .map((label, labelIndex) => (label ? `<c:pt idx="${labelIndex}"><c:v>${escapeXml(label)}</c:v></c:pt>` : ""))
    .join("");
  const numeric = series.points
    .map((point, pointIndex) => (point == null || !Number.isFinite(point) ? "" : `<c:pt idx="${pointIndex}"><c:v>${point}</c:v></c:pt>`))
    .join("");
  const cache = numeric
    ? `<c:numCache><c:formatCode>0.000</c:formatCode><c:ptCount val="${series.points.length}"/>${numeric}</c:numCache>`
    : "";
  const color = seriesColor(series.name, index);
  // Urutan elemen mengikuti skema OOXML (CT_BarSer / CT_LineSer / CT_PieSer); Excel menolak urutan lain.
  const style =
    kind === "bar"
      ? `<c:spPr><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></c:spPr><c:invertIfNegative val="0"/>${spec.kind === "bar" ? barLabels(spec.valueFormat) : ""}`
      : kind === "line"
        ? `<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="6"/><c:spPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="19050"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></a:ln></c:spPr></c:marker>`
        : doughnutExtras(labels, spec.kind === "pie");
  return `<c:ser>
    <c:idx val="${index}"/>
    <c:order val="${index}"/>
    <c:tx><c:v>${escapeXml(series.name)}</c:v></c:tx>${style}
    <c:cat>
      <c:strRef>
        <c:f>${escapeXml(spec.categories)}</c:f>
        <c:strCache><c:ptCount val="${labels.length}"/>${cats}</c:strCache>
      </c:strRef>
    </c:cat>
    <c:val>
      <c:numRef>
        <c:f>${escapeXml(series.values)}</c:f>
        ${cache}
      </c:numRef>
    </c:val>${kind === "line" ? '<c:smooth val="0"/>' : ""}
  </c:ser>`;
}

function barLabels(format = "#,##0.0"): string {
  return `<c:dLbls><c:numFmt formatCode="${escapeXml(format)}" sourceLinked="0"/><c:spPr><a:noFill/></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="900"/></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr><c:dLblPos val="outEnd"/><c:showLegendKey val="0"/><c:showVal val="1"/><c:showCatName val="0"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/></c:dLbls>`;
}

function doughnutExtras(labels: string[], outside: boolean): string {
  const points = labels
    .map((label, index) => `<c:dPt><c:idx val="${index}"/><c:bubble3D val="0"/><c:spPr><a:solidFill><a:srgbClr val="${sliceColor(label.split(" — ")[0]?.split("\n")[0] ?? label)}"/></a:solidFill><a:ln><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></c:spPr></c:dPt>`)
    .join("");
  // Nama kategori sudah memuat uraian HS, nilai juta USD, dan persentase (dihitung di lembar _VIEW),
  // sehingga format angka Excel tidak bisa menimpa persentase.
  const dLbls = `<c:dLbls><c:spPr><a:noFill/></c:spPr><c:txPr><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="800"/></a:pPr><a:endParaRPr lang="id-ID"/></a:p></c:txPr>${outside ? '<c:dLblPos val="bestFit"/>' : ""}<c:showLegendKey val="0"/><c:showVal val="0"/><c:showCatName val="1"/><c:showSerName val="0"/><c:showPercent val="0"/><c:showBubbleSize val="0"/><c:showLeaderLines val="1"/></c:dLbls>`;
  return points + dLbls;
}

export function chartXml(spec: ChartSpec): string {
  const seriesKind: SeriesKind = spec.kind === "line" ? "line" : spec.kind === "doughnut" || spec.kind === "pie" ? "doughnut" : "bar";
  const plotted = spec.series.map((series, index) => seriesXml(series, index, spec, seriesKind));
  const plot =
    spec.kind === "line"
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${plotted.join("")}<c:marker val="1"/><c:smooth val="0"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>`
      : spec.kind === "pie"
        ? `<c:pieChart><c:varyColors val="1"/>${plotted.join("")}<c:firstSliceAng val="0"/></c:pieChart>`
      : spec.kind === "doughnut"
        ? `<c:doughnutChart><c:varyColors val="1"/>${plotted.join("")}<c:firstSliceAng val="0"/><c:holeSize val="50"/></c:doughnutChart>`
        : spec.kind === "combo"
          ? comboPlot(spec)
          : `<c:barChart><c:barDir val="${spec.kind === "bar" ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${plotted.join("")}<c:gapWidth val="80"/><c:overlap val="0"/><c:axId val="10"/><c:axId val="20"/></c:barChart>`;
  const axes =
    spec.kind === "doughnut" || spec.kind === "pie"
      ? ""
      : `<c:catAx><c:axId val="10"/><c:scaling><c:orientation val="${spec.kind === "bar" ? "maxMin" : "minMax"}"/></c:scaling><c:delete val="0"/><c:axPos val="${spec.kind === "bar" ? "l" : "b"}"/>${axisTitle(spec.categoryTitle, spec.kind === "bar")}<c:numFmt formatCode="@" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx>
      <c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${spec.kind === "bar" ? "b" : "l"}"/><c:majorGridlines/>${axisTitle(spec.valueTitle, spec.kind !== "bar")}<c:numFmt formatCode="${escapeXml(spec.valueFormat ?? "#,##0")}" sourceLinked="0"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="${spec.kind === "bar" ? "max" : "autoZero"}"/><c:crossBetween val="between"/></c:valAx>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1200"/></a:pPr><a:r><a:rPr lang="id-ID" sz="1200" b="1"/><a:t>${escapeXml(spec.title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>
    <c:plotArea>
      <c:layout/>
      ${plot}
      ${axes}
    </c:plotArea>
    ${spec.kind === "pie" || spec.kind === "bar" ? "" : `<c:legend><c:legendPos val="${spec.kind === "doughnut" ? "r" : "b"}"/><c:overlay val="0"/></c:legend>`}
    <c:plotVisOnly val="0"/>
    <c:dispBlanksAs val="gap"/>
  </c:chart>
</c:chartSpace>`;
}

function comboPlot(spec: ChartSpec): string {
  const bars = spec.series
    .map((series, index) => ({ series, index }))
    .filter((item) => item.series.plot !== "line");
  const lines = spec.series
    .map((series, index) => ({ series, index }))
    .filter((item) => item.series.plot === "line");
  return `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${bars
    .map((item) => seriesXml(item.series, item.index, spec, "bar"))
    .join("")}<c:gapWidth val="80"/><c:overlap val="0"/><c:axId val="10"/><c:axId val="20"/></c:barChart><c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${lines
    .map((item) => seriesXml(item.series, item.index, spec, "line"))
    .join("")}<c:marker val="1"/><c:smooth val="0"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>`;
}

function drawingXml(charts: ChartSpec[]): string {
  const anchors = charts
    .map((chart, index) => {
      const id = index + 2;
      return `<xdr:twoCellAnchor>
        <xdr:from><xdr:col>${chart.anchor.fromCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.anchor.fromRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
        <xdr:to><xdr:col>${chart.anchor.toCol}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${chart.anchor.toRow}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
        <xdr:graphicFrame macro="">
          <xdr:nvGraphicFramePr><xdr:cNvPr id="${id}" name="Chart ${index + 1}"/><xdr:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></xdr:cNvGraphicFramePr></xdr:nvGraphicFramePr>
          <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
          <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic>
        </xdr:graphicFrame>
        <xdr:clientData/>
      </xdr:twoCellAnchor>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart">${anchors}</xdr:wsDr>`;
}

export async function injectCharts(filename: string, dashboardName: string, charts: ChartSpec[]): Promise<void> {
  if (!charts.length) return;
  const zip = await JSZip.loadAsync(await readFile(filename));
  const workbookXml = await must(zip, "xl/workbook.xml");
  const workbookRels = await must(zip, "xl/_rels/workbook.xml.rels");
  const sheetTag = [...workbookXml.matchAll(/<sheet\b[^>]*>/g)].map((match) => match[0]).find((tag) => attr(tag, "name") === dashboardName);
  if (!sheetTag) throw new Error(`Worksheet ${dashboardName} was not found in workbook.xml.`);
  const relationId = attr(sheetTag, "r:id");
  if (!relationId) throw new Error("Dashboard sheet is missing a relationship id.");
  const relation = [...workbookRels.matchAll(/<Relationship\b[^>]*>/g)].map((match) => match[0]).find((tag) => attr(tag, "Id") === relationId);
  const target = relation ? attr(relation, "Target") : null;
  if (!target) throw new Error("Dashboard worksheet target was not found.");
  const sheetPath = target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\.\//, "")}`;
  let sheetXml = await must(zip, sheetPath);
  const sheetRelsPath = sheetPath.replace("xl/worksheets/", "xl/worksheets/_rels/") + ".rels";
  const existingRels = zip.file(sheetRelsPath) ? await must(zip, sheetRelsPath) : null;
  const nextRid = existingRels ? nextRelationshipId(existingRels) : "rId1";
  if (!sheetXml.includes("<drawing ")) {
    const drawing = `<drawing r:id="${nextRid}"/>`;
    if (!sheetXml.includes("xmlns:r=")) {
      sheetXml = sheetXml.replace(
        "<worksheet ",
        '<worksheet xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ',
      );
    }
    sheetXml = sheetXml.replace("</worksheet>", `${drawing}</worksheet>`);
    zip.file(sheetPath, sheetXml);
  }
  const drawingRel = existingRels
    ? existingRels.replace(
        "</Relationships>",
        `<Relationship Id="${nextRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`,
      )
    : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${nextRid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/></Relationships>`;
  zip.file(sheetRelsPath, drawingRel);
  zip.file("xl/drawings/drawing1.xml", drawingXml(charts));
  const drawingRels = charts
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${index + 1}.xml"/>`,
    )
    .join("");
  zip.file(
    "xl/drawings/_rels/drawing1.xml.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${drawingRels}</Relationships>`,
  );
  charts.forEach((chart, index) => {
    zip.file(`xl/charts/chart${index + 1}.xml`, chartXml(chart));
  });
  let contentTypes = await must(zip, "[Content_Types].xml");
  const overrides = [
    `<Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`,
    ...charts.map(
      (_, index) =>
        `<Override PartName="/xl/charts/chart${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`,
    ),
  ];
  for (const override of overrides) {
    if (!contentTypes.includes(override)) contentTypes = contentTypes.replace("</Types>", `${override}</Types>`);
  }
  if (!contentTypes.includes('fullCalcOnLoad="1"')) {
    // calc mode lives in workbook.xml, not content types.
  }
  zip.file("[Content_Types].xml", contentTypes);
  let workbook = workbookXml;
  if (!workbook.includes("fullCalcOnLoad")) {
    if (workbook.includes("<calcPr")) workbook = workbook.replace("<calcPr", '<calcPr fullCalcOnLoad="1" calcMode="auto"');
    else workbook = workbook.replace("</workbook>", '<calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>');
  }
  zip.file("xl/workbook.xml", workbook);
  const output = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await writeFile(filename, output);
}

function attr(tag: string, name: string): string | null {
  const match = tag.match(new RegExp(`${name}="([^"]*)"`));
  return match?.[1] ?? null;
}

function nextRelationshipId(rels: string): string {
  const ids = [...rels.matchAll(/Id="rId(\d+)"/g)].map((match) => Number(match[1]));
  return `rId${Math.max(0, ...ids) + 1}`;
}

async function must(zip: JSZip, path: string): Promise<string> {
  const file = zip.file(path);
  if (!file) throw new Error(`Missing ${path} inside the workbook.`);
  return file.async("string");
}
