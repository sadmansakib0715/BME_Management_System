import type { CourseType } from '@/lib/types';
import { Badge } from './ui';

export function TypeBadge({ type }: { type: CourseType }) {
  const label = { theory: 'Theory', sessional: 'Sessional', design: 'Design', thesis: 'Thesis', attachment: 'Attachment' }[type];
  return <Badge tone={type === 'theory' ? 'info' : 'brand'}>{label}</Badge>;
}
