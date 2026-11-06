// Course-folder generator (stage 2): course information + outline + filled marks → the course file as a zip,
// laid out like the department's BME 211 (theory) and BME 310 (sessional) folders.
import JSZip from 'jszip';
import { carDocx, coPoMappingDocx, instructorsDocx, reportDocx } from './docs';
import { checkInfo, infoFromOutline, loadWorkbook, mergeMapping, mergeSiteCos, readCourseInfo, readOutline } from './inputs';
import {
  clean, computeAttainment, fmtNum, initials, isSessional, safeName, sampleStats, studentIds,
  type Attainment, type CO, type CourseInfo, type Marks, type Outline, type Sample, Warnings,
} from './model';
import { numberedFolders, planFromOutline, type Plan } from './plan';
import { courseWorkbook, marksTemplate, readCounts, readPrevious, readSessionalMarks, readTheoryWorkbook, sessionalInputs } from './workbook';

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

/** Roll range typed on the page when there is no course_information.xlsx (student IDs = batch + 18 + roll). */
export interface RollInput { semester: string; batch: string; count: number; missingIds: string[]; /** irregular students, full IDs */ extraIds?: string[] }
/** What the faculty gives: the course outline (required), the CO-PO Mapping.docx when the outline has no CO table, the course
    information workbook or else the roll range, and the website's COs for this course as a last source of the CO-PO mapping. */
export interface Sources { outline: Bytes; mapping?: Bytes | null; info?: Bytes | null; roll?: RollInput | null; siteCos?: CO[] }

/** The student IDs entered on the page replace the workbook's sections sheet (the section names are kept for the CAR). */
function withRoll(info: CourseInfo, roll: RollInput, w: Warnings): CourseInfo {
  const before = info.sections.some((x) => x.first_roll || x.extra_ids) ? studentIds(info) : [];
  const out: CourseInfo = { ...info, extra: { ...info.extra, batch: roll.batch },
    sections: [{ section: info.sections.map((x) => clean(x.section)).filter(Boolean).join(', '), first_roll: '1', last_roll: String(roll.count), extra_ids: (roll.extraIds ?? []).join(', '), exclude_ids: roll.missingIds.join(', ') }] };
  const after = studentIds(out);
  if (before.length && (before.length !== after.length || before.some((x, i) => x !== after[i])))
    w.add(`the course information's sections sheet lists ${before.length} students (${before[0]} to ${before[before.length - 1]}); the marks sheet uses the ${after.length} entered on this page`);
  return out;
}

/** Reads and cross-checks the inputs. */
export async function readSources(s: Sources, w: Warnings): Promise<{ info: CourseInfo; outline: Outline }> {
  let outline = await readOutline(s.outline);
  if (s.mapping) outline = await mergeMapping(outline, s.mapping, w);
  if (s.siteCos?.length) outline = mergeSiteCos(outline, s.siteCos);
  if (!outline.cos.some((c) => c.pos.length)) w.add('no CO-PO mapping found: add the CO-PO Mapping.docx (or set the mapping on the OBE page), otherwise PO attainment cannot be worked out');
  let info: CourseInfo;
  if (s.info) {
    info = checkInfo(await readCourseInfo(s.info), outline, w);
    if (s.roll) info = withRoll(info, s.roll, w);
  } else if (s.roll) info = infoFromOutline(outline, s.roll);
  else throw new Error('give the course information workbook, or the batch and number of students');
  return { info, outline };
}

/** What the page shows before the download: the inputs as read, the assessment tree, and anything to check. */
export async function previewSources(s: Sources) {
  const w = new Warnings();
  const { info, outline } = await readSources(s, w);
  const plan = planFromOutline(info, outline, w);
  return { info, outline, plan, warnings: w.list };
}

/** Stage 1: the blank marks sheet for the faculty to download, from the assessment tree (as edited on the page). */
export async function buildMarksTemplate(s: Sources, plan?: Plan) {
  const w = new Warnings();
  const { info, outline } = await readSources(s, w);
  const p = plan ?? planFromOutline(info, outline, w);
  const bytes = await marksTemplate(info, outline, w, p);
  return { bytes, fileName: `${info.courseNo} marks (${info.semester}).xlsx`, info, outline, plan: p, warnings: w.list, sessional: isSessional(info) };
}

/** Stage 2: the course folder. */
/** `counts`: how many of each assessment were taken (from the page); otherwise as saved in the marks sheet. Folders only. */
export async function buildCourseFolder(a: Sources & { marks: Bytes; previous?: Bytes | null; templates: Templates; counts?: Record<string, number> }): Promise<BuildResult> {
  const w = new Warnings();
  const { info, outline } = await readSources(a, w);
  const cno = info.courseNo;

  let marks: Marks, spec, data, folders;
  // The uploaded sheet says which layout it is: the one-sheet `ca` layout, or the theory workbook.
  const book = await loadWorkbook(a.marks);
  if (book.getWorksheet('ca')) {
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
  const counts = { ...readCounts(book), ...(a.counts ?? {}) };
  for (const { folder, name, max, s } of samples) {
    const sub = numberedFolders(folder, counts[name] ?? counts[folder] ?? 1);
    sub.forEach((f) => {
      const lines = [`${cno} - ${f} (${sub.length > 1 ? `marks sheet: ${name}, ` : ''}out of ${fmtNum(max)})`, '', 'Upload into this folder:', '  - the question / task sheet',
        '  - scanned scripts of the three students below, named Highest.pdf, Average.pdf, Lowest.pdf', '',
        ...(sub.length > 1 ? [`  (The students are picked from the marks entered for ${name}.)`, ''] : []),
        ...(['highest', 'average', 'lowest'] as const).map((k) => `  ${(k[0].toUpperCase() + k.slice(1)).padEnd(8)}: ${s[k] ? `${s[k]![0]}  (${fmtNum(s[k]![1])})` : '-'}`),
        ...(s.mean === null ? [] : ['', `Class mean: ${s.mean.toFixed(2)}. 'Average' = the student closest to the mean.`])];
      asm.folder(safeName(f))!.file('Sample scripts to upload.txt', `${lines.join('\n')}\n`);
    });
  }
  if (isSessional(info)) {
    const label = /lab|exp/i.test(outline.planHeader.join(' ')) ? 'Lab' : 'Week';
    outline.plan.forEach((_, k) => lec.folder(`${label} - ${String(k + 1).padStart(2, '0')}`));
  } else for (const sub of ['Book', 'Note', ...info.faculties.map((f) => initials(clean(f.name)))]) lec.folder(sub);

  const files = Object.keys(zip.files).sort();
  return { zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }), fileName: `${root}.zip`, info, outline, attainment: att,
    students: marks.ids.length, warnings: w.list, files };
}
