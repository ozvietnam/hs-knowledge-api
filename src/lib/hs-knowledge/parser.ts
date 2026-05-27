// Layer: L3
// Module: hs-knowledge-parser
// Ticket: SPR-W158-02
//
// Parse markdown output từ MarkItDown của PDF TCHQ chú giải HS code
// thành array of HsExplanatoryNote rows với hierarchy detection.

export type HsLevel = "SECTION" | "CHAPTER" | "HEADING" | "SUBHEADING" | "NATIONAL";
export type HsNoteType =
  | "GENERAL_NOTE"
  | "INCLUDES"
  | "EXCLUDES"
  | "DEFINITION"
  | "CLASSIFICATION_RULE"
  | "OTHER";

export type ParsedNote = {
  level: HsLevel;
  code: string;
  parentCode: string | null;
  titleVi: string | null;
  noteType: HsNoteType;
  noteVi: string;
  sourcePage: number | null;
  sourceFile: string;
};

const RE_SECTION =
  /^#{1,2}\s+Phần\s+(I|II|III|IV|V|VI|VII|VIII|IX|X|XI|XII|XIII|XIV|XV|XVI|XVII|XVIII|XIX|XX|XXI)\b/im;
const RE_CHAPTER = /^#{1,3}\s+Chương\s+(\d{1,2})\b/im;
const RE_HEADING = /^#{1,4}\s+(\d{2})\.(\d{2})\b/m;
const RE_SUBHEADING = /^#{1,5}\s+(\d{2})(\d{2})\.(\d{2})\b/m;
const RE_NATIONAL = /^#{1,6}\s+(\d{8,12})\b/m;

const RE_INCLUDES = /(?:^|\n)\s*(?:Nhóm này|Chương này)?\s*(?:bao gồm|gồm có|gồm)\s*:?\s*/i;
const RE_EXCLUDES = /(?:^|\n)\s*(?:Loại trừ|Không bao gồm|Trừ|chương này không bao gồm)\s*:?\s*/i;
const RE_DEFINITION = /(?:^|\n)\s*Theo\s+(?:nhóm|chương)\s+này.{0,80}(?:nghĩa là|có nghĩa)/i;
const RE_RULE = /(?:^|\n)\s*Quy tắc/i;

function pad2(s: string) {
  return s.padStart(2, "0");
}

export function parseHsExplanatoryMarkdown(md: string, sourceFile: string): ParsedNote[] {
  const rows: ParsedNote[] = [];
  const lines = md.split("\n");

  let curSection: string | null = null;
  let curChapter: string | null = null;
  let curHeading: string | null = null;
  let curSubheading: string | null = null;
  let curContext: { level: HsLevel; code: string } | null = null;
  let buffer: string[] = [];

  const flushBuffer = () => {
    if (!curContext || buffer.length === 0) return;
    const content = buffer.join("\n").trim();
    if (!content) {
      buffer = [];
      return;
    }

    const chunks = splitByNoteType(content);
    for (const chunk of chunks) {
      rows.push({
        level: curContext.level,
        code: curContext.code,
        parentCode: parentCodeFor(curContext),
        titleVi: null,
        noteType: chunk.noteType,
        noteVi: chunk.text,
        sourcePage: null,
        sourceFile,
      });
    }
    buffer = [];
  };

  function parentCodeFor(ctx: { level: HsLevel; code: string }): string | null {
    switch (ctx.level) {
      case "SECTION":
        return null;
      case "CHAPTER":
        return curSection;
      case "HEADING":
        return curChapter;
      case "SUBHEADING":
        return curHeading;
      case "NATIONAL":
        return curSubheading;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";

    const mSection = line.match(RE_SECTION);
    if (mSection && mSection[1]) {
      flushBuffer();
      curSection = mSection[1].toUpperCase();
      const title = lines.slice(i + 1, i + 4).find((l) => l.trim() && !l.startsWith("#"));
      rows.push({
        level: "SECTION",
        code: curSection,
        parentCode: null,
        titleVi: title?.trim() ?? null,
        noteType: "GENERAL_NOTE",
        noteVi: title?.trim() ?? "",
        sourcePage: null,
        sourceFile,
      });
      curChapter = null;
      curHeading = null;
      curSubheading = null;
      curContext = { level: "SECTION", code: curSection };
      continue;
    }

    const mChapter = line.match(RE_CHAPTER);
    if (mChapter && mChapter[1]) {
      flushBuffer();
      curChapter = pad2(mChapter[1]);
      const title = lines.slice(i + 1, i + 4).find((l) => l.trim() && !l.startsWith("#"));
      rows.push({
        level: "CHAPTER",
        code: curChapter,
        parentCode: curSection,
        titleVi: title?.trim() ?? null,
        noteType: "GENERAL_NOTE",
        noteVi: title?.trim() ?? "",
        sourcePage: null,
        sourceFile,
      });
      curHeading = null;
      curSubheading = null;
      curContext = { level: "CHAPTER", code: curChapter };
      continue;
    }

    const mHeading = line.match(RE_HEADING);
    if (mHeading && mHeading[1] && mHeading[2]) {
      flushBuffer();
      curHeading = pad2(mHeading[1]) + pad2(mHeading[2]);
      const title = lines.slice(i + 1, i + 4).find((l) => l.trim() && !l.startsWith("#"));
      rows.push({
        level: "HEADING",
        code: curHeading,
        parentCode: curChapter,
        titleVi: title?.trim() ?? null,
        noteType: "GENERAL_NOTE",
        noteVi: title?.trim() ?? "",
        sourcePage: null,
        sourceFile,
      });
      curSubheading = null;
      curContext = { level: "HEADING", code: curHeading };
      continue;
    }

    const mSub = line.match(RE_SUBHEADING);
    if (mSub && mSub[1] && mSub[2] && mSub[3]) {
      flushBuffer();
      curSubheading = pad2(mSub[1]) + pad2(mSub[2]) + pad2(mSub[3]);
      const title = lines.slice(i + 1, i + 4).find((l) => l.trim() && !l.startsWith("#"));
      rows.push({
        level: "SUBHEADING",
        code: curSubheading,
        parentCode: curHeading,
        titleVi: title?.trim() ?? null,
        noteType: "GENERAL_NOTE",
        noteVi: title?.trim() ?? "",
        sourcePage: null,
        sourceFile,
      });
      curContext = { level: "SUBHEADING", code: curSubheading };
      continue;
    }

    const mNat = line.match(RE_NATIONAL);
    if (mNat && mNat[1]) {
      flushBuffer();
      const code: string = mNat[1];
      const title = lines.slice(i + 1, i + 4).find((l) => l.trim() && !l.startsWith("#"));
      rows.push({
        level: "NATIONAL",
        code,
        parentCode: curSubheading,
        titleVi: title?.trim() ?? null,
        noteType: "GENERAL_NOTE",
        noteVi: title?.trim() ?? "",
        sourcePage: null,
        sourceFile,
      });
      curContext = { level: "NATIONAL", code };
      continue;
    }

    if (/^#{2,}\s+Chú giải/i.test(line) || /^#{2,}\s+Ghi chú/i.test(line)) {
      flushBuffer();
      continue;
    }

    buffer.push(line);
  }
  flushBuffer();

  // Reparent DEFINITION/INCLUDES/EXCLUDES notes that reference an
  // ancestor scope ("Theo nhóm này" → HEADING, "Chương này" → CHAPTER).
  // PDF flow puts these phrases under whatever heading the parser was
  // tracking at the time, but the note semantically belongs to the
  // referenced scope.
  for (const row of rows) {
    if (row.noteType === "DEFINITION" && /Theo\s+nhóm\s+này/i.test(row.noteVi)) {
      if (row.level !== "HEADING") {
        const headingCode = ancestorHeadingCode(row.code, row.level);
        if (headingCode) {
          row.level = "HEADING";
          row.code = headingCode;
          row.parentCode = headingCode.slice(0, 2);
        }
      }
    } else if (row.noteType === "DEFINITION" && /Theo\s+chương\s+này/i.test(row.noteVi)) {
      if (row.level !== "CHAPTER") {
        const chapterCode = row.code.slice(0, 2);
        row.level = "CHAPTER";
        row.code = chapterCode;
        // parentCode for chapter is the section — leave as-is if already set,
        // otherwise null (parser may not have a section at this point).
      }
    }
  }

  return rows;
}

function ancestorHeadingCode(code: string, level: HsLevel): string | null {
  // HEADING codes are 4 chars (e.g. "0102"); SUBHEADING is 6 ("010221");
  // NATIONAL is 8+ ("01012100"). The heading is always the first 4 chars.
  if (level === "SUBHEADING" || level === "NATIONAL") {
    return code.slice(0, 4);
  }
  return null;
}

function splitByNoteType(content: string): { noteType: HsNoteType; text: string }[] {
  const markers: { idx: number; type: HsNoteType }[] = [];

  const findAll = (re: RegExp, type: HsNoteType) => {
    const r = new RegExp(re.source, "gim");
    let m: RegExpExecArray | null;
    while ((m = r.exec(content)) !== null) {
      markers.push({ idx: m.index, type });
    }
  };

  findAll(RE_INCLUDES, "INCLUDES");
  findAll(RE_EXCLUDES, "EXCLUDES");
  findAll(RE_DEFINITION, "DEFINITION");
  findAll(RE_RULE, "CLASSIFICATION_RULE");

  if (markers.length === 0) {
    return [{ noteType: "GENERAL_NOTE", text: content.trim() }];
  }

  markers.sort((a, b) => a.idx - b.idx);
  const chunks: { noteType: HsNoteType; text: string }[] = [];

  const first = markers[0];
  if (first && first.idx > 0) {
    const pre = content.slice(0, first.idx).trim();
    if (pre) chunks.push({ noteType: "GENERAL_NOTE", text: pre });
  }

  for (let i = 0; i < markers.length; i++) {
    const cur = markers[i];
    if (!cur) continue;
    const next = markers[i + 1];
    const start = cur.idx;
    const end = next ? next.idx : content.length;
    const text = content.slice(start, end).trim();
    if (text) chunks.push({ noteType: cur.type, text });
  }

  return chunks;
}
