import { StrictMode, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dialog from './Dialog';

interface HarnessProps {
  onClose?: () => void;
  withInput?: boolean;
  initialFocus?: 'title' | 'body';
  /** The opener cannot take focus back once the dialog is open (as a link in a closed menu). */
  openerGoesAway?: boolean;
}

function Harness({ onClose, withInput = false, initialFocus = 'title', openerGoesAway = false }: HarnessProps) {
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fallbackRef = useRef<HTMLButtonElement>(null);
  const [gone, setGone] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setGone(openerGoesAway);
        }}
        disabled={gone}
      >
        opener
      </button>
      <button type="button" ref={fallbackRef}>
        fallback
      </button>
      <Dialog
        open={open}
        onClose={() => {
          onClose?.();
          setOpen(false);
        }}
        title="Test dialog"
        initialFocus={withInput ? inputRef : initialFocus}
        returnFocus={() => [null, fallbackRef.current]}
      >
        <p>content</p>
        <input ref={inputRef} aria-label="field" />
      </Dialog>
    </>
  );
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'opener' }));
  return screen.getByRole('dialog', { name: 'Test dialog' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Dialog', () => {
  it('is not in the document while closed', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('opens as a modal with showModal, named by its title, in a portal on body', async () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype, 'showModal');
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await openDialog(user);

    expect(showModal).toHaveBeenCalledTimes(1);
    expect(dialog).toHaveAttribute('open');
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog).toHaveAttribute('aria-labelledby', screen.getByRole('heading', { name: 'Test dialog' }).id);
  });

  it('moves focus to the title by default, or to the given element', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Harness />);
    await openDialog(user);
    expect(screen.getByRole('heading', { name: 'Test dialog' })).toHaveFocus();
    unmount();

    render(<Harness withInput />);
    await openDialog(user);
    expect(screen.getByLabelText('field')).toHaveFocus();
  });

  it('Escape closes it and focus returns to the opener', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} withInput />);
    await openDialog(user);

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'opener' })).toHaveFocus();
  });

  it('a cancel request from the browser closes it through onClose', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const dialog = await openDialog(user);

    const cancel = new Event('cancel', { cancelable: true });
    fireEvent(dialog, cancel);

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('a close the browser makes on its own brings state in line', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const dialog = (await openDialog(user)) as HTMLDialogElement;

    // As a browser does: the element is closed first, then 'close' fires
    // (the setupTests stub of close() does both).
    act(() => dialog.close());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute('data-overlay');
  });

  it('a late close event that arrives while it is open again is ignored', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const dialog = await openDialog(user);

    fireEvent(dialog, new Event('close'));

    expect(onClose).not.toHaveBeenCalled();
    expect(dialog).toHaveAttribute('open');
  });

  it('under StrictMode, a close the browser makes on its own still closes it', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <StrictMode>
        <Harness onClose={onClose} />
      </StrictMode>,
    );
    const dialog = (await openDialog(user)) as HTMLDialogElement;
    expect(dialog).toHaveAttribute('open');

    act(() => dialog.close());

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.documentElement).not.toHaveAttribute('data-overlay');
  });

  it('can start on its scrolling body, focusable but not a Tab stop', async () => {
    const user = userEvent.setup();
    render(<Harness initialFocus="body" />);
    await openDialog(user);

    const body = screen.getByText('content').parentElement!;
    expect(body).toHaveFocus();
    expect(body).toHaveAttribute('tabindex', '-1');
  });

  it('sends focus to the returnFocus fallback when the opener cannot take it back', async () => {
    const user = userEvent.setup();
    render(<Harness openerGoesAway />);
    await openDialog(user);
    expect(screen.getByRole('button', { name: 'opener' })).toBeDisabled();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'fallback' })).toHaveFocus();
  });

  it('closing it itself is not reported back as a close request', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    await openDialog(user);

    await user.click(screen.getByRole('button', { name: 'Close' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a click on the backdrop closes it; a click inside does not', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const dialog = await openDialog(user);

    await user.click(screen.getByText('content'));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a drag that starts inside and ends on the backdrop does not close it', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<Harness onClose={onClose} />);
    const dialog = await openDialog(user);

    fireEvent.pointerDown(screen.getByText('content'));
    fireEvent.click(dialog);

    expect(onClose).not.toHaveBeenCalled();
  });

  it('locks the page scroll while open', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await openDialog(user);
    expect(document.documentElement).toHaveAttribute('data-overlay', 'open');

    await user.keyboard('{Escape}');
    expect(document.documentElement).not.toHaveAttribute('data-overlay');
  });
});
