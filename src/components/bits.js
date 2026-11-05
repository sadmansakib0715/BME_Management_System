import { jsx as _jsx } from "react/jsx-runtime";
import { Badge } from './ui';
export function TypeBadge({ type }) {
    const label = { theory: 'Theory', sessional: 'Sessional', design: 'Design', thesis: 'Thesis', attachment: 'Attachment' }[type];
    return _jsx(Badge, { tone: type === 'theory' ? 'info' : 'brand', children: label });
}
