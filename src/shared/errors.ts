/** Error codes the server can return; the client translates them (English text is the fallback). */
export const ERROR_TEXT = {
  'bad-request': 'Bad request.',
  'bad-user': 'Username must be 1-32 characters.',
  'bad-pass': 'Password must be 1-8 characters.',
  'wrong-pass': 'Wrong password.',
  cooldown: 'You can play once per {every} minutes. Try again in {left} min.',
  session: 'Session expired. Please log in again.',
  'no-account': 'Account not found.',
  pending: 'You already have a newborn waiting to fight.',
  'not-ranked': 'That slime is not available as a mate.',
  'no-seeds': 'That slime has no seeds left.',
  'no-newborn': 'There is no newborn to fight with.',
  'empty-comment': 'Write something first.',
  'not-found': 'Not found.',
  server: 'Server error.',
} as const;
export type ErrorCode = keyof typeof ERROR_TEXT;
