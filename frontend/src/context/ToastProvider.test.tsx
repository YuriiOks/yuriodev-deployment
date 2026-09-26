import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider } from './ToastProvider';
import { useToast } from './useToast';

function Trigger() {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show({ message: 'Could not copy. The address is a@b.c', durationMs: 8000 })}>
      show
    </button>
  );
}

function renderToast() {
  render(
    <ToastProvider>
      <Trigger />
    </ToastProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'show' }));
  return screen.getByText('Could not copy. The address is a@b.c');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  document.getSelection()?.removeAllRanges();
  vi.useRealTimers();
});

const advance = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

describe('ToastProvider', () => {
  it('shows the message in the status region and removes it after its time', () => {
    const toast = renderToast();
    expect(screen.getByRole('status')).toContainElement(toast);

    advance(7999);
    expect(toast).toBeInTheDocument();
    advance(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('stays while the pointer rests on it, then gets its full time again', () => {
    const toast = renderToast();
    advance(7000);

    fireEvent.pointerEnter(toast);
    advance(20000);
    expect(toast).toBeInTheDocument();

    fireEvent.pointerLeave(toast);
    advance(7999);
    expect(toast).toBeInTheDocument();
    advance(1);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('stays while text in it is selected', () => {
    const toast = renderToast();
    const range = document.createRange();
    range.selectNodeContents(toast);
    document.getSelection()!.addRange(range);

    advance(30000);
    expect(toast).toBeInTheDocument();

    document.getSelection()!.removeAllRanges();
    advance(8000);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });
});
