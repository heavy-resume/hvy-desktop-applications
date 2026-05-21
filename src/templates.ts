import blankTemplate from './templates/blank.hvy?raw';
import notesTemplate from './templates/notes.hvy?raw';
import reportTemplate from './templates/report.hvy?raw';

export interface HvyTemplate {
  id: string;
  name: string;
  content: string;
}

export const hvyTemplates: HvyTemplate[] = [
  { id: 'blank', name: 'Blank', content: blankTemplate },
  { id: 'notes', name: 'Notes', content: notesTemplate },
  { id: 'report', name: 'Report', content: reportTemplate },
];

export function getHvyTemplate(id: string): HvyTemplate {
  return hvyTemplates.find((template) => template.id === id) ?? hvyTemplates[0];
}
