import { describe, expect, it, vi } from 'vitest';

import { AnswerSaveQueue } from './answer-save-queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe('answer autosave navigation barrier', () => {
  it('shares an in-flight save with navigation and sends newer drafts with the returned revision', async () => {
    const first = deferred<number>();
    const send = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValueOnce(9);
    const states = vi.fn();
    const queue = new AnswerSaveQueue(7, send, states);
    queue.enqueue('a', { text: 'first' });
    const saving = queue.flush();
    queue.enqueue('a', { text: 'newest' });
    expect(queue.flush()).toBe(saving);
    expect(send).toHaveBeenCalledTimes(1);
    first.resolve(8);
    expect(await saving).toBe(true);
    expect(send.mock.calls).toEqual([
      ['a', { text: 'first' }, 7],
      ['a', { text: 'newest' }, 8],
    ]);
    expect(states.mock.calls.filter(([state]) => state === 'saved')).toHaveLength(1);
    expect(queue.dirty).toBe(false);
  });

  it('keeps a failed draft and refuses navigation until a successful retry', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(4);
    const queue = new AnswerSaveQueue(3, send, vi.fn());
    queue.enqueue('a', 0);
    expect(await queue.flush()).toBe(false);
    expect(queue.dirty).toBe(true);
    expect(await queue.flush()).toBe(true);
    expect(send.mock.calls).toEqual([
      ['a', 0, 3],
      ['a', 0, 3],
    ]);
    expect(queue.dirty).toBe(false);
  });

  it('does not save queued drafts or report success after leaving the attempt', async () => {
    const pending = deferred<number>();
    const send = vi.fn().mockReturnValue(pending.promise);
    const states = vi.fn();
    const queue = new AnswerSaveQueue(1, send, states);
    queue.enqueue('a', 1);
    const saving = queue.flush();
    queue.enqueue('b', 2);
    queue.dispose();
    pending.resolve(2);
    expect(await saving).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
    expect(states).not.toHaveBeenCalledWith('saved');
  });
});
