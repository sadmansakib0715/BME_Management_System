// Row types mirror supabase/migrations. Keep them in sync when a migration changes a table.

export type AppRole = 'faculty' | 'admin' | 'hod';
export type CourseType = 'theory' | 'sessional' | 'design' | 'thesis' | 'attachment';

export interface Faculty { id: string; full_name: string; display_name: string; designation: string | null; email: string | null; status: 'active' | 'on_leave' | 'former'; }
export interface AllowedUser { email: string; faculty_id: string | null; app_role: AppRole; active: boolean; }
export interface Course { id: string; code: string; title: string; course_type: CourseType; level: number | null; term_no: number | null; credits: number | null; contact_hours: number | null; elective_group: 'I' | 'II' | null; }
export interface Term { id: string; code: string; name: string; starts_on: string | null; ends_on: string | null; total_weeks: number; latest_completed_week: number; calendar_status: 'active' | 'paused'; pause_reason: string | null; is_current: boolean; read_only: boolean; }
export interface Offering { id: string; term_id: string; course_id: string; batch: string | null; status: 'draft' | 'active' | 'archived'; }
export interface Section { id: string; offering_id: string; name: string; }
export interface SectionTeacher { section_id: string; faculty_id: string; position: number; }
export type MilestoneKind = 'outline_sharing' | 'question_submission' | 'exam_start' | 'theory_gradesheet' | 'sessional_gradesheet' | 'feedback_deadline' | 'car_deadline';
export interface Milestone { id: string; term_id: string; offering_id: string | null; kind: MilestoneKind; due_on: string; }

export interface ExamAssignment { offering_id: string; qp_a: string | null; qp_b: string | null; mod_1: string | null; mod_2: string | null; scrutinizer: string | null; }
export type ExamStep = 'qp_a' | 'qp_b' | 'mod_1' | 'mod_2' | 'printing' | 'exam_a' | 'exam_b' | 'scrutiny' | 'gs_prep' | 'gs_scrutiny' | 'hod';
export interface ExamTask { offering_id: string; step: ExamStep; status: string; due_on: string | null; note: string | null; updated_by: string | null; updated_at: string; }
export interface ModerationRound { id: string; offering_id: string; moderator_step: 'mod_1' | 'mod_2'; half: 'A' | 'B'; comment: string | null; returned_by: string | null; returned_at: string; resolved_at: string | null; }
export interface SessionalGradesheet { offering_id: string; preparer: string | null; scrutinizer: string | null; prep_status: string; scrutiny_status: string; }
export interface CourseRecord { offering_id: string; outline_status: string; feedback_status: string; car_status: string; notes: string | null; }

export interface PO { code: string; no: number; title: string; statement: string; k_profiles: string | null; }
export interface PEO { code: string; statement: string; }
export interface CourseOutcome { id: string; offering_id: string; code: string; statement: string; domain: 'cognitive' | 'affective' | 'psychomotor'; level: number; sort: number; }
export interface CoPo { co_id: string; po_code: string; strength: 1 | 2 | 3; }
export interface Student { id: string; student_no: string; name: string; batch: string | null; }
export interface Enrolment { offering_id: string; student_id: string; section_id: string | null; }

export type ComponentKind = 'attendance' | 'class_test' | 'term_final' | 'lab_report' | 'lab_test' | 'quiz' | 'viva' | 'presentation' | 'demonstration' | 'project' | 'assignment' | 'other';
export interface AssessmentComponent { id: string; offering_id: string; kind: ComponentKind; name: string; item_count: number; marks_each: number; weight: number; best_n: number | null; per_section: boolean; sort: number; }
export type ItemStatus = 'planned' | 'scheduled' | 'held' | 'postponed' | 'cancelled';
export type MarksStatus = 'none' | 'entering' | 'verified' | 'published' | 'locked';
export interface AssessmentItem { id: string; component_id: string; offering_id: string; section_id: string | null; seq: number; title: string; held_on: string | null; held_time: string | null; total_marks: number; status: ItemStatus; marks_status: MarksStatus; responsible: string | null; syllabus: string | null; }
export interface ItemDateHistory { id: string; item_id: string; old_date: string | null; new_date: string | null; reason: string | null; changed_by: string | null; changed_at: string; }
export interface Question { id: string; item_id: string; label: string; max_marks: number; co_id: string | null; sort: number; }
export interface Mark { question_id: string; student_id: string; value: number | null; flag: 'AB' | 'EX' | null; }
export interface AttainmentSettings { term_id: string; x_pct: number; y_pct: number; level1: number; level2: number; level3: number; }
