// Course-folder generator (stage 2): course information + outline + filled marks → the course file as a zip,
// laid out like the department's BME 211 (theory) and BME 310 (sessional) folders.
import JSZip from 'jszip';
import { carDocx, coPoMappingDocx, instructorsDocx, reportDocx } from './docs';
import { readCourseInfo, readOutline } from './inputs';
import {
  clean, computeAttainment, fmtNum, fmtPct, initials, isSessional, norm, safeName, sampleStats, studentIds,
  type Attainment, type CourseInfo, type Marks, type Outline, type Sample, Warnings,
} from './model';
import { courseWorkbook, marksTemplate, readPrevious, readSessionalMarks, readTheoryWorkbook, sessionalInputs } from './workbook';

export type Bytes = ArrayBuffer | Uint8Array;
export interface Templates { car: Bytes; coPoMapping: Bytes; instructors: Bytes }

export interface BuildResult {
  zip: Uint8Array;
  fileName: string;
  info: CourseInfo;
  outline: Outline;
  attainment: Attainment;
  students: number;
  warnings: string[];
  files: string[];
}

/** Stage 1: the blank marks sheet for the faculty to download. */
export async function buildMarksTemplate(infoFile: Bytes, outlineFile: Bytes) {
  const w = new Warnings();
  const info = await readCourseInfo(infoFile);
  const outline = await readOutline(outlineFile);
  const bytes = await marksTemplate(info, outline, w);
  return { bytes, fileName: `${info.courseNo} marks (${info.semester}).xlsx`, info, outline, warnings: w.list, sessional: isSessional(info) };
}

/** Stage 2: the course folder. */
export async function buildCourseFolder(a: { info: Bytes; outline: Bytes; marks: Bytes; previous?: Bytes | null; templates: Templates }): Promise<BuildResult> {
  const w = new Warnings();
  const info = await readCourseInfo(a.info);
  const outline = await readOutline(a.outline);
  const cno = info.courseNo;
  if (outline.courseNo && norm(outline.courseNo) !== norm(cno)) w.add(`the outline is for '${outline.courseNo}' but the course information says '${cno}'`);

  let marks: Marks, spec, data, folders;
  if (isSessional(info)) {
    marks = await readSessionalMarks(a.marks, outline, w);
    ({ spec, data, folders } = sessionalInputs(marks, w));
  } else {
    ({ marks, spec, data, folders } = await readTheoryWorkbook(a.marks, info, outline, w));
  }
  if (info.sections.length) {
    const expected = new Set(studentIds(info));
    const got = new Set(marks.ids);
    const missing = [...expected].filter((x) => !got.has(x)), extra = [...got].filter((x) => !expected.has(x));
    if (missing.length) w.add(`students in the roll range but not in the marks: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? '…' : ''}`);
    if (extra.length) w.add(`students in the marks but not in the roll range: ${extra.slice(0, 10).join(', ')}`);
  }
  const att = computeAttainment(outline, marks, w);
  const prev = a.previous ? await readPrevious(a.previous, w) : null;

  const root = safeName(`${cno} (${info.semester})`);
  const zip = new JSZip();
  const dir = zip.folder(root)!;
  const asm = dir.folder(isSessional(info) ? 'Assessment and Scripts' : 'Assessments and scripts')!;
  const lec = dir.folder('Lecture Materials')!;

  dir.file(`${cno}_Course outline.docx`, a.outline);
  dir.file('CO-PO Mapping.docx', await coPoMappingDocx(a.templates.coPoMapping, outline));
  dir.file('Instructors and Schedule.docx', await instructorsDocx(a.templates.instructors, info));
  dir.file('CAR.docx', await carDocx(a.templates.car, info, outline, att, prev));
  const samples: { folder: string; name: string; max: number; s: Sample }[] = folders.map((f) => ({ folder: f.folder, name: f.name, max: f.max, s: sampleStats(f.values) }));
  dir.file('CO-PO Attainment Report.docx', await reportDocx(info, outline, att, marks, samples));
  const link = clean(info.extra.bugs_resolution_link);
  if (link) dir.file('BUGS Resolution.url', `[InternetShortcut]\r\nURL=${link}\r\n`);
  else dir.file('BUGS Resolution - add link.txt', "Paste the BUGS resolution link for this course (or add 'bugs_resolution_link' to course_information.xlsx).\n");

  asm.file(`${cno}-CO-PO-Assessment-marks.xlsx`, await courseWorkbook(info, outline, marks.ids, spec, data, false, att));
  for (const { folder, name, max, s } of samples) {
    const lines = [`${cno} - ${name} (out of ${fmtNum(max)})`, '', 'Upload into this folder:', '  - the question / task sheet',
      '  - scanned scripts of the three students below, named Highest.pdf, Average.pdf, Lowest.pdf', '',
      ...(['highest', 'average', 'lowest'] as const).map((k) => `  ${(k[0].toUpperCase() + k.slice(1)).padEnd(8)}: ${s[k] ? `${s[k]![0]}  (${fmtNum(s[k]![1])})` : '-'}`),
      ...(s.mean === null ? [] : ['', `Class mean: ${s.mean.toFixed(2)}. 'Average' = the student closest to the mean.`])];
    asm.folder(safeName(folder))!.file('Sample scripts to upload.txt', `${lines.join('\n')}\n`);
  }
  if (isSessional(info)) {
    const label = /lab|exp/i.test(outline.planHeader.join(' ')) ? 'Lab' : 'Week';
    outline.plan.forEach((_, k) => lec.folder(`${label} - ${String(k + 1).padStart(2, '0')}`));
  } else for (const sub of ['Book', 'Note', ...info.faculties.map((f) => initials(clean(f.name)))]) lec.folder(sub);

  dir.file('_generation_log.txt', [
    `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`, `Students: ${marks.ids.length}`,
    `CO cohort: ${att.coUsed.map((c) => `CO${c}=${fmtPct(att.co.get(c)!.pct)}`).join(', ')}`,
    `PO cohort: ${att.poUsed.map((p) => `PO${p}=${fmtPct(att.po.get(p)!.pct)}`).join(', ')}`, '', 'Warnings:',
    ...(w.list.length ? w.list.map((x) => `  - ${x}`) : ['  none'])].join('\n') + '\n');

  const files = Object.keys(zip.files).sort();
  return { zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), fileName: `${root}.zip`, info, outline, attainment: att,
    students: marks.ids.length, warnings: w.list, files };
}
