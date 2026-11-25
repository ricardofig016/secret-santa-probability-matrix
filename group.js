export const MAX_PEOPLE = 18;
export const CLUE_OPTIONS = [
  { value: '', label: 'No clue' },
  { value: 'excluded', label: 'Definitely excluded' },
  { value: 'much-less', label: 'Strongly less likely', factor: 0.25 },
  { value: 'less', label: 'Somewhat less likely', factor: 0.5 },
  { value: 'more', label: 'Somewhat more likely', factor: 2 },
  { value: 'much-more', label: 'Strongly more likely', factor: 4 },
  { value: 'confirmed', label: 'Confirmed' },
];
export const RELATIVE_WEIGHTS = new Map(CLUE_OPTIONS.filter(option => option.factor).map(({ value, factor }) => [value, factor]));

export function validateGroup(group) {
  const text = value => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= 80 && !/[\u0000-\u001f]/.test(value);
  const only = (object, keys) => object && typeof object === 'object' && !Array.isArray(object) && Object.keys(object).every(key => keys.includes(key));
  if (!only(group, ['name', 'participants', 'team', 'pairs']) || !text(group.name)) throw new Error('Enter a group name of 1 to 80 characters.');
  const { name, participants, team, pairs } = group;
  if (typeof team !== 'boolean') throw new Error('Team play must be on or off.');
  if (!Array.isArray(participants) || participants.length > MAX_PEOPLE || !participants.every(text) || new Set(participants).size !== participants.length) {
    throw new Error(`Use up to ${MAX_PEOPLE} distinct names of 1 to 80 characters each.`);
  }
  const names = new Set(participants);
  function check(list, field, accept) {
    if (!Array.isArray(list) || list.length > participants.length ** 2) throw new Error(`Invalid ${field} list.`);
    const seen = new Set();
    return list.map(item => {
      if (!only(item, ['giver', 'recipient', field]) || !names.has(item.giver) || !names.has(item.recipient) || item.giver === item.recipient || !accept(item[field])) throw new Error(`Invalid pair in ${field} list.`);
      const key = JSON.stringify([item.giver, item.recipient]);
      if (seen.has(key)) throw new Error(`Duplicate pair in ${field} list.`);
      seen.add(key);
      return { giver: item.giver, recipient: item.recipient, [field]: item[field] };
    });
  }
  return { name, participants: [...participants], team, pairs: check(pairs, 'state', v => v === 'excluded' || v === 'confirmed' || RELATIVE_WEIGHTS.has(v)) };
}
