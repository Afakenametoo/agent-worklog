import fs from "node:fs/promises";
import path from "node:path";
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeightRule,
  LevelFormat,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from "docx";
import type { WeeklyContent } from "../shared/types.js";
import { config } from "./config.js";
import { ensureDirectory, isoWeekRange } from "./util.js";

const tableBorder = { style: BorderStyle.SINGLE, size: 4, color: "59544C" };
const cellBorders = {
  top: tableBorder,
  bottom: tableBorder,
  left: tableBorder,
  right: tableBorder
};

function listParagraphs(items: string[], reference: string): Paragraph[] {
  const values = items.length ? items : ["暂无。"];
  return values.map(
    (item) =>
      new Paragraph({
        numbering: { reference, level: 0 },
        spacing: { after: 100, line: 320 },
        children: [new TextRun({ text: item, font: "仿宋", size: 22 })]
      })
  );
}

function labelCell(text: string, width: number, span = 1): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: span,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 120, right: 120 },
    borders: cellBorders,
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text, bold: true, font: "方正小标宋简体", size: 22 })]
      })
    ]
  });
}

function valueCell(text: string, width: number, span = 1): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: span,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 120, bottom: 120, left: 150, right: 150 },
    borders: cellBorders,
    children: [
      new Paragraph({
        spacing: { line: 320 },
        children: [new TextRun({ text, font: "仿宋", size: 22 })]
      })
    ]
  });
}

function sectionRow(title: string): TableRow {
  return new TableRow({
    height: { value: 538, rule: HeightRule.ATLEAST },
    children: [labelCell(title, 8647, 4)]
  });
}

export async function createWeeklyDocx(
  isoWeek: string,
  content: WeeklyContent,
  outputRoot = config.weeklyReportRoot
): Promise<string> {
  const range = isoWeekRange(isoWeek);
  const rows: TableRow[] = [
    new TableRow({
      height: { value: 543, rule: HeightRule.ATLEAST },
      children: [labelCell("项目名称", 1418, 2), valueCell(content.projectName, 7229, 2)]
    }),
    new TableRow({
      height: { value: 409, rule: HeightRule.ATLEAST },
      children: [labelCell("起止日期", 1418, 2), valueCell(content.dateRange, 7229, 2)]
    }),
    new TableRow({
      height: { value: 415, rule: HeightRule.ATLEAST },
      children: [labelCell("编写人", 1418, 2), valueCell(content.author, 7229, 2)]
    }),
    sectionRow("本周事务开展及完成情况"),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 8647, type: WidthType.DXA },
          columnSpan: 4,
          margins: { top: 160, bottom: 120, left: 150, right: 150 },
          borders: cellBorders,
          children: listParagraphs(content.workItems, "work-list")
        })
      ]
    }),
    new TableRow({
      height: { value: 538, rule: HeightRule.ATLEAST },
      children: [
        labelCell("序号", 1248),
        labelCell("工作中遇到的主要问题", 3402, 2),
        labelCell("采取的对策", 3997)
      ]
    }),
    ...(content.problems.length ? content.problems : [{ problem: "暂无", solution: "暂无" }]).map(
      (item, index) =>
        new TableRow({
          children: [
            labelCell(String(index + 1), 1248),
            valueCell(item.problem, 3402, 2),
            valueCell(item.solution, 3997)
          ]
        })
    ),
    sectionRow("下周工作计划"),
    new TableRow({
      children: [
        new TableCell({
          width: { size: 8647, type: WidthType.DXA },
          columnSpan: 4,
          margins: { top: 160, bottom: 120, left: 150, right: 150 },
          borders: cellBorders,
          children: listParagraphs(content.nextWeekPlans, "plan-list")
        })
      ]
    }),
    sectionRow("需要协助的事项"),
    new TableRow({
      children: [valueCell(content.needHelp || "暂无需要协助的事项。", 8647, 4)]
    })
  ];

  const doc = new Document({
    styles: {
      default: {
        document: { run: { font: "仿宋", size: 22 } }
      },
      paragraphStyles: [
        {
          id: "ReportTitle",
          name: "Report Title",
          basedOn: "Normal",
          run: { size: 36, bold: true, font: "方正小标宋简体" },
          paragraph: { alignment: AlignmentType.CENTER, spacing: { after: 220 } }
        }
      ]
    },
    numbering: {
      config: ["work-list", "plan-list"].map((reference) => ({
        reference,
        levels: [
          {
            level: 0,
            format: LevelFormat.DECIMAL,
            text: "%1.",
            alignment: AlignmentType.LEFT,
            style: { paragraph: { indent: { left: 420, hanging: 420 } } }
          }
        ]
      }))
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1440, right: 1800, bottom: 1440, left: 1800 } }
        },
        children: [
          new Paragraph({
            style: "ReportTitle",
            children: [new TextRun({ text: "周报", font: "方正小标宋简体" })]
          }),
          new Table({
            width: { size: 8647, type: WidthType.DXA },
            columnWidths: [1248, 170, 3232, 3997],
            rows
          })
        ]
      }
    ]
  });

  const dir = path.join(outputRoot, range.folderName);
  await ensureDirectory(dir);
  const outputPath = path.join(dir, `${content.author}${range.fileRange}.docx`);
  const temporary = `${outputPath}.tmp`;
  await fs.writeFile(temporary, await Packer.toBuffer(doc));
  await fs.rename(temporary, outputPath);
  return outputPath;
}

export async function inspectWeeklyDocx(filePath: string): Promise<{
  exists: boolean;
  bytes: number;
  extensionValid: boolean;
}> {
  const stat = await fs.stat(filePath);
  const first = await fs.readFile(filePath).then((buffer) => buffer.subarray(0, 2).toString("hex"));
  return {
    exists: true,
    bytes: stat.size,
    extensionValid: path.extname(filePath).toLowerCase() === ".docx" && first === "504b"
  };
}
